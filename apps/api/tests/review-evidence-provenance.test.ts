import { createGoogle } from "@ai-sdk/google";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeminiReviewService } from "#integrations/gemini";
import type {
	ReviewConclusion,
	ReviewFinding,
	ReviewInput,
	ReviewInputChunk,
	ReviewSourceCatalog,
	ReviewSourceDocument,
	ReviewModelResult,
} from "#features/review";
import { readReviewSourceRange } from "../src/features/review/utils/review-source-range.util.js";

const MODEL = {
	id: "01991700-0000-7000-8000-000000000038",
	apiName: "gemini-3.8-flash",
	inputNanoUsdPerToken: 750,
	cachedInputNanoUsdPerToken: 75,
	outputNanoUsdPerToken: 3750,
};
const PATH = "src/example.ts";
const CHUNK: ReviewInputChunk = {
	changedLines: new Map([[PATH, new Set([2])]]),
	diff: `diff --git a/${PATH} b/${PATH}\n--- a/${PATH}\n+++ b/${PATH}\n@@ -1,2 +1,2 @@\n function example() {\n-old\n+new`,
	referenceBefore: "",
	referenceAfter: "",
	index: 1,
	total: 1,
};
const CONTENT = "function example() {\n  return 1;\n}\n";
const INPUT: ReviewInput = {
	baseSha: "branch-tip",
	headSha: "head-sha",
	body: "Preserve existing caller behavior.",
	title: "Adjust example",
	chunks: [CHUNK],
	githubInstallationAccountLogin: "external-owner",
	pullRequestNumber: 1,
	repositoryFullName: "external-owner/example",
	reviewRunId: "provenance-run",
	repositoryContext: {
		repositoryFullName: "external-owner/example",
		revision: "head-sha",
		files: [{ kind: "loaded", path: PATH, content: CONTENT }],
		omittedFileCount: 0,
	},
};
const FINDING: ReviewFinding = {
	severity: "high",
	path: PATH,
	line: 2,
	title: "Concrete candidate",
	rationale: "Reachable caller contract changes.",
};

function conclusion(
	evidence: ReviewConclusion["hypotheses"][number]["evidence"][number],
	outcome: "refuted" | "candidate" = "refuted",
): ReviewConclusion {
	return {
		status: "complete",
		reviewedPaths: [PATH],
		hypotheses: [
			{
				path: PATH,
				line: 2,
				scenario: "Valid caller input",
				expectedBehavior: "Preserve caller contract",
				observedBehavior: "Checked exact source",
				outcome,
				evidence: [evidence],
				missingEvidence: [],
			},
		],
	};
}
const HEAD = {
	path: PATH,
	role: "head" as const,
	revision: INPUT.headSha,
	startLine: 1,
	endLine: 2,
};

function output(recorded: ReviewConclusion, findings: readonly ReviewFinding[] = []): Response {
	return google([{ text: JSON.stringify({ conclusion: recorded, findings }) }]);
}
function google(parts: readonly object[]): Response {
	return Response.json({
		candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
		usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
	});
}
function call(name: string, args: object): Response {
	return google([{ functionCall: { name, args }, thoughtSignature: "opaque-signature" }]);
}
function harness(responses: readonly Response[]) {
	const remaining = [...responses];
	const requests: string[] = [];
	const fetchGoogle: typeof fetch = async (_url, init) => {
		if (typeof init?.body !== "string") throw new Error("Missing Google request body.");
		requests.push(init.body);
		const response = remaining.shift();
		if (response === undefined) throw new Error("Unexpected extra model call.");
		return response;
	};
	return {
		requests,
		model: new GeminiReviewService(
			createGoogle({ apiKey: "test-key", fetch: fetchGoogle }),
			{ listTools: async () => [], callTool: async () => ({}) },
			pino({ enabled: false }),
		),
	};
}
function catalog(content = CONTENT): ReviewSourceCatalog {
	const documents: readonly ReviewSourceDocument[] = ["head", "before"].map((role) => ({
		source: {
			role: role === "head" ? "head" : "before",
			path: PATH,
			revision: role === "head" ? INPUT.headSha : "merge-base",
			repositoryFullName: INPUT.repositoryFullName,
			contentHash: null,
		},
		content,
	}));
	return {
		revisions: documents.map((document) => document.source),
		list: async () => ({
			kind: "page",
			entries: documents.map((document) => ({
				...document.source,
				kind: "file",
				sizeBytes: null,
			})),
			totalEntries: documents.length,
			nextCursor: null,
		}),
		read: async ({ source, range }) => {
			const document = documents.find(
				(entry) => entry.source.role === source.role && entry.source.path === source.path,
			);
			return document === undefined
				? { kind: "missing", source }
				: readReviewSourceRange(document, range);
		},
		search: async () => ({
			kind: "page",
			matches: [],
			totalSources: 0,
			scannedSources: 0,
			unavailable: [],
			nextCursor: null,
		}),
		related: async () => ({ kind: "page", entries: [], totalEntries: 0, nextCursor: null }),
		recordInvestigation: async () => {
			throw new Error("No large transcript should be archived in this fixture.");
		},
	};
}
function execution(sources: ReviewSourceCatalog) {
	return {
		sources,
		signal: new AbortController().signal,
		recordUsage: () => {},
		recordMetric: () => {},
	};
}

function outcome(
	result: Promise<ReviewModelResult>,
): Promise<"verified" | "context_response_invalid"> {
	return result.then(
		() => "verified",
		(error: unknown) =>
			z.object({ issue: z.literal("context_response_invalid") }).parse(error).issue,
	);
}
const WITHOUT_INLINE: ReviewInput = {
	...INPUT,
	repositoryContext: { ...INPUT.repositoryContext, files: [] },
};

describe("review evidence provenance through Google transport", () => {
	it("accepts supplied inline sources and sends an associated candidate to the caller", async () => {
		const { model } = harness([output(conclusion(HEAD, "candidate"), [FINDING])]);
		await expect(model.review(MODEL, INPUT, CHUNK)).resolves.toMatchObject({
			findings: [FINDING],
			investigation: { kind: "verified" },
		});
	});

	it.each([
		{ ...HEAD, path: "src/invented.ts" },
		{ ...HEAD, endLine: 100 },
		{ ...HEAD, revision: "different-head" },
		{ ...HEAD, role: "investigation" as const, revision: "unconfirmed" },
	])("rejects an ungrounded citation $path:$endLine at $revision", async (evidence) => {
		const { model } = harness([output(conclusion(evidence)), output(conclusion(evidence))]);
		await expect(model.review(MODEL, INPUT, CHUNK)).rejects.toMatchObject({
			issue: "context_response_invalid",
		});
	});

	it.each([
		{
			recorded: conclusion(HEAD, "candidate"),
			findings: [],
			failure: { code: "candidate_missing_finding", hypothesisIndex: 0 },
		},
		{
			recorded: {
				...conclusion(HEAD),
				hypotheses: [
					...conclusion(HEAD).hypotheses,
					...conclusion(HEAD, "candidate").hypotheses,
				],
			},
			findings: [],
			failure: { code: "candidate_missing_finding", hypothesisIndex: 1 },
		},
		{
			recorded: conclusion(HEAD),
			findings: [FINDING],
			failure: { code: "finding_missing_candidate", findingIndex: 0 },
		},
		{
			recorded: conclusion(HEAD, "candidate"),
			findings: [{ ...FINDING, line: 1 }],
			failure: { code: "finding_location_invalid", findingIndex: 0 },
		},
	])(
		"rejects an invalid finding association with $failure.code",
		async ({ recorded, findings, failure }) => {
			const { model } = harness([output(recorded, findings), output(recorded, findings)]);
			await expect(model.review(MODEL, INPUT, CHUNK)).rejects.toMatchObject({
				issue: "context_response_invalid",
				failure,
			});
		},
	);

	it.each(["merge-base", INPUT.baseSha])(
		"uses the before catalog revision, not the branch tip (%s)",
		async (revision) => {
			const { model } = harness([
				call("source_read", {
					source: { role: "before", path: PATH },
					range: { kind: "lines", startLine: 1, lineCount: 3 },
				}),
				output(conclusion({ ...HEAD, role: "before", revision })),
				...(revision === "merge-base"
					? []
					: [output(conclusion({ ...HEAD, role: "before", revision }))]),
			]);
			const result = model.review(MODEL, WITHOUT_INLINE, CHUNK, execution(catalog()));
			expect(await outcome(result)).toBe(
				revision === "merge-base" ? "verified" : "context_response_invalid",
			);
		},
	);

	it("does not turn manifest references into evidence of a read", async () => {
		const { model } = harness([
			call("source_list", { role: "head", prefix: "", cursor: null, limit: 10 }),
			output(conclusion(HEAD)),
			output(conclusion(HEAD)),
		]);
		await expect(
			model.review(MODEL, WITHOUT_INLINE, CHUNK, execution(catalog())),
		).rejects.toMatchObject({ issue: "context_response_invalid" });
	});

	it.each([false, true])(
		"requires all column pages before accepting an entire long line (continued: %s)",
		async (continued) => {
			const first = call("source_read", {
				source: { role: "head", path: PATH },
				range: { kind: "lines", startLine: 1, lineCount: 1 },
			});
			const second = call("source_read", {
				source: { role: "head", path: PATH },
				range: { kind: "columns", line: 1, startColumn: 4096, columnCount: 16000 },
			});
			const { model } = harness([
				first,
				...(continued ? [second] : []),
				output(conclusion({ ...HEAD, endLine: 1 })),
				...(continued ? [] : [output(conclusion({ ...HEAD, endLine: 1 }))]),
			]);
			const result = model.review(
				MODEL,
				WITHOUT_INLINE,
				CHUNK,
				execution(catalog("x".repeat(6000))),
			);
			expect(await outcome(result)).toBe(continued ? "verified" : "context_response_invalid");
		},
	);

	it("keeps retrieval enabled after an ungrounded complete checkpoint", async () => {
		const invalid = conclusion({ ...HEAD, path: "src/invented.ts" });
		const incomplete: ReviewConclusion = {
			status: "incomplete",
			reviewedPaths: [PATH],
			hypotheses: [
				{
					...conclusion(HEAD).hypotheses[0]!,
					outcome: "unresolved",
					evidence: [],
					missingEvidence: ["Need exact source"],
				},
			],
			gaps: ["Need exact source"],
		};
		const { model, requests } = harness([
			call("investigation_checkpoint", {
				conclusion: incomplete,
				nextTools: ["source_search"],
			}),
			call("investigation_checkpoint", { conclusion: invalid, nextTools: [] }),
			call("source_read", {
				source: { role: "head", path: PATH },
				range: { kind: "lines", startLine: 1, lineCount: 3 },
			}),
			output(conclusion(HEAD)),
		]);
		await expect(
			model.review(MODEL, WITHOUT_INLINE, CHUNK, execution(catalog())),
		).resolves.toMatchObject({ investigation: { kind: "verified" } });
		expect(requests[2]).toContain('"name":"source_read"');
		expect(requests[2]).toContain("correction_required");
		expect(requests[2]).toContain("evidence_not_delivered");
	});

	it("does not combine a financial path with a return added in another file", async () => {
		const other = "src/payment.ts";
		const input: ReviewInput = {
			...INPUT,
			repositoryContext: {
				...INPUT.repositoryContext,
				files: [
					...INPUT.repositoryContext.files,
					{ kind: "loaded", path: other, content: CONTENT },
				],
			},
		};
		const chunk: ReviewInputChunk = {
			...CHUNK,
			changedLines: new Map([
				[PATH, new Set([2])],
				[other, new Set([2])],
			]),
			diff: `diff --git a/${PATH} b/${PATH}\n--- a/${PATH}\n+++ b/${PATH}\n@@ -1 +1 @@\n-old\n+return newValue\ndiff --git a/${other} b/${other}\n--- a/${other}\n+++ b/${other}\n@@ -1 +1 @@\n-old\n+const title = "Adjusted"`,
		};
		const single = conclusion(HEAD);
		const recorded: ReviewConclusion = {
			status: "complete",
			reviewedPaths: [PATH, other],
			hypotheses: [
				...single.hypotheses,
				{ ...single.hypotheses[0]!, path: other, evidence: [{ ...HEAD, path: other }] },
			],
		};
		const { model, requests } = harness([output(recorded)]);
		await expect(model.review(MODEL, input, chunk)).resolves.toMatchObject({ findings: [] });
		expect(requests).toHaveLength(1);
	});
});
