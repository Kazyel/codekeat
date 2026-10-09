import type { ModelMessage, ToolResultPart } from "ai";
import { Effect } from "effect";
import { z } from "zod";
import type { ReviewSourceCatalog, ReviewSourceReference } from "#features/review";

const retrievalState = z.object({
	source: z
		.object({
			role: z.enum(["head", "before", "pull_request", "investigation"]),
			path: z.string(),
			revision: z.string(),
			repositoryFullName: z.string().nullable(),
			contentHash: z.string().nullable(),
		})
		.optional(),
	kind: z.string().optional(),
	status: z.string().optional(),
	gaps: z.array(z.string()).optional(),
	unavailable: z.array(z.json()).optional(),
	nextCursor: z.string().nullable().optional(),
	nextRange: z.json().optional(),
	incompleteReason: z.string().nullable().optional(),
});

/** Replaces old transport payloads with exact, recoverable originals while preserving call/result pairs. */
export class ReviewTranscript {
	constructor(
		private readonly sources: ReviewSourceCatalog | null,
		private readonly signal: AbortSignal,
	) {}

	compact(messages: readonly ModelMessage[]): Promise<ModelMessage[]> {
		if (this.sources === null) return Promise.resolve([...messages]);
		return Effect.runPromise(
			Effect.forEach(
				messages,
				(message, index) => {
					if (message.role !== "tool" || index >= messages.length - 4)
						return Effect.succeed(message);
					return Effect.forEach(
						message.content,
						(part) => {
							if (part.type !== "tool-result" || !part.toolName.startsWith("source_"))
								return Effect.succeed(part);
							return this.archive(part);
						},
						{ concurrency: 1 },
					).pipe(Effect.map((content): ModelMessage => ({ ...message, content })));
				},
				{ concurrency: 1 },
			),
			{ signal: this.signal },
		);
	}

	private archive(part: ToolResultPart): Effect.Effect<ToolResultPart, Error> {
		const sources = this.sources;
		if (sources === null) return Effect.succeed(part);
		if (part.output.type !== "json") return Effect.succeed(part);
		const state = retrievalState.safeParse(part.output.value);
		const retained = state.success ? state.data : {};
		if (retained.kind === "archived_tool_result") return Effect.succeed(part);
		const original = JSON.stringify(part.output);
		return Effect.tryPromise({
			try: async (): Promise<ToolResultPart> => {
				// Archive only when the recoverable wrapper is smaller than the actual payload.
				const wrapperEstimate = JSON.stringify(
					archivedResult(
						part,
						{
							role: "investigation",
							path: "mcp/" + "0".repeat(64),
							revision: "unconfirmed",
							repositoryFullName: null,
							contentHash: "sha256:" + "0".repeat(64),
						},
						retained,
					).output,
				);
				if (original.length <= wrapperEstimate.length) return part;
				const source = await sources.recordInvestigation(
					"review_transcript",
					JSON.stringify({ toolCallId: part.toolCallId, tool: part.toolName }),
					original,
					this.signal,
				);
				const archived = archivedResult(part, source, retained);
				if (original.length <= JSON.stringify(archived.output).length) return part;
				return archived;
			},
			catch: () => new Error("Could not preserve the investigation transcript."),
		});
	}
}

function archivedResult(
	part: ToolResultPart,
	source: ReviewSourceReference,
	retained: z.infer<typeof retrievalState>,
): ToolResultPart {
	return {
		...part,
		output: {
			type: "json",
			value: {
				kind: "archived_tool_result",
				source: { ...source },
				readWith: "source_read",
				range: { kind: "lines", startLine: 1, lineCount: 1 },
				originalRetrieval: retained,
				note: "Exact original preserved. Read this archive with source_read and follow its returned continuation. originalRetrieval describes the original tool's source, continuations and evidence gaps, which do not refer to this archive.",
			},
		},
	};
}
