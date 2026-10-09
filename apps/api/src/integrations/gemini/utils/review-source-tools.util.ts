import { tool, type ToolSet } from "ai";
import { Effect, Semaphore } from "effect";
import { z } from "zod";
import { captureModelMetrics } from "./review-model-metrics.util.js";

import {
	type ReviewContextExchange,
	type ReviewSourceCatalog,
	type ReviewSourceReference,
	type ReviewSourceReadRequest,
	type ReviewSourceReadResult,
	type ReviewSourceReadPage,
	type ReviewSourceListPage,
	type ReviewSourceSearchPage,
	type ReviewSourceUnavailable,
	ReviewModelResponseError,
	ReviewSourceCoverageIncomplete,
} from "#features/review";

const ROLE = z.enum(["head", "before", "pull_request", "investigation"]);
const SOURCE_PAGE_COLUMNS = 4_096;
const SOURCE = z
	.object({
		role: ROLE,
		path: z.string().min(1),
		contentHash: z
			.string()
			.regex(/^(?:sha256:[a-f0-9]{64}|git:[a-f0-9]{40})$/)
			.nullable()
			.optional(),
	})
	.strict();
const PAGE = z
	.object({
		role: ROLE,
		prefix: z.string(),
		cursor: z.string().nullable(),
		limit: z.number().int().min(1).max(50),
	})
	.strict();
const RANGE = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("lines"),
			startLine: z.number().int().positive(),
			lineCount: z.number().int().min(1).max(200),
		})
		.strict(),
	z
		.object({
			kind: z.literal("columns"),
			line: z.number().int().positive(),
			startColumn: z.number().int().nonnegative(),
			columnCount: z.number().int().min(1).max(16_000),
		})
		.strict(),
]);
type SourceResult =
	| ReviewSourceReadResult
	| ReviewSourceListPage
	| ReviewSourceSearchPage
	| ReviewSourceUnavailable;

/** Tools cannot choose hosts, repositories or SHAs; the catalog owns that authorization. */
export class ReviewSourceTools {
	private readonly metrics = captureModelMetrics();
	private readonly calls = Semaphore.makeUnsafe(4);
	private readonly recorded: ReviewContextExchange[] = [];
	private failure: ReviewModelResponseError | null = null;
	private readonly readIntervals = new Map<string, { start: number; end: number }[]>();

	constructor(
		private readonly sources: ReviewSourceCatalog,
		private readonly signal: AbortSignal,
	) {}

	get exchanges(): readonly ReviewContextExchange[] {
		return this.recorded;
	}

	tools(): ToolSet {
		return {
			source_list: tool({
				description:
					"List snapshot sources with a paginated manifest. head is the PR revision; before is the merge-base; pull_request contains body and diff artifacts. Follow nextCursor until the relevant paths are located.",
				inputSchema: PAGE,
				execute: (args) =>
					this.call("source_list", args, () => this.sources.list(args, this.signal)),
			}),
			source_read: tool({
				description:
					"Read an exact source range. Lines are one-based; columns are UTF16 offsets with an exclusive end. Follow nextRange to read more. An unavailable page is not evidence that validation or consumers are absent.",
				inputSchema: z.object({ source: SOURCE, range: RANGE }).strict(),
				execute: (args) => this.call("source_read", args, () => this.read(args)),
			}),
			source_search: tool({
				description:
					"Search literal text or paths in the exact snapshot. Returns positions, not potentially huge snippets. Read matching ranges with source_read; follow nextCursor even when the current page has no matches.",
				inputSchema: PAGE.extend({
					mode: z.enum(["path", "content"]),
					query: z.string().min(1),
					scanLimit: z.number().int().min(1).max(20),
				}),
				execute: (args) =>
					this.call("source_search", args, () => this.sources.search(args, this.signal)),
			}),
			source_related: tool({
				description:
					"Find verified relative imports and related test files. Use source_search for callers and consumers beyond these local relationships.",
				inputSchema: z
					.object({
						source: SOURCE,
						cursor: z.string().nullable(),
						limit: z.number().int().min(1).max(50),
					})
					.strict(),
				execute: (args) =>
					this.call("source_related", args, () =>
						this.sources.related(args, this.signal),
					),
			}),
		};
	}

	throwIfFailed(): void {
		this.signal.throwIfAborted();
		if (this.failure !== null) throw this.failure;
	}

	assertCoverage(required: ReviewRequiredSourceRead | null): void {
		if (required === null) return;
		const intervals = this.readIntervals.get(required.source.contentHash ?? "") ?? [];
		if (coveredColumns(intervals) < required.columns)
			throw new ReviewSourceCoverageIncomplete({ reason: required.reason });
	}

	private async read(request: ReviewSourceReadRequest): Promise<ReviewSourceReadResult> {
		const page = boundedReadPage(await this.sources.read(request, this.signal));
		if (page.kind === "loaded" && page.startLine === 1 && page.endLine === 1) {
			this.recordReadInterval(page);
		}
		return page;
	}

	private recordReadInterval(page: ReviewSourceReadPage): void {
		const key = page.source.contentHash ?? "";
		const intervals = this.readIntervals.get(key) ?? [];
		intervals.push({ start: page.startColumn, end: page.endColumn });
		this.readIntervals.set(key, intervals);
	}

	private call<T extends SourceResult>(
		name: string,
		args: z.JSONType,
		request: () => Promise<T>,
	): Promise<T> {
		const startedAt = performance.now();
		return Effect.runPromise(
			this.calls.withPermit(
				Effect.tryPromise({
					try: async () => {
						this.throwIfFailed();
						const result = await request();
						this.recorded.push({
							tool: name,
							argumentsJson: JSON.stringify(args),
							responseJson: JSON.stringify(result),
						});
						this.metrics.record({
							phase: "tool",
							durationMs: performance.now() - startedAt,
							outcome: "success",
							requestCount: 1,
							sourceBytes: Buffer.byteLength(JSON.stringify(result)),
							sourceCount: observedSourceCount(result),
						});
						return result;
					},
					catch: () => {
						this.metrics.record({
							phase: "tool",
							durationMs: performance.now() - startedAt,
							outcome: this.signal.aborted ? "cancelled" : "failed",
							requestCount: 1,
						});
						this.failure ??= new ReviewModelResponseError("context_response_invalid");
						return this.failure;
					},
				}),
			),
			{ signal: this.signal },
		);
	}
}

function observedSourceCount(result: SourceResult): number {
	if (result.kind === "loaded") return 1;
	if (result.kind !== "page") return 0;
	return "entries" in result ? result.entries.length : result.scannedSources;
}

/** Page limits control transport only; the exact remaining source stays reachable via nextRange. */
function boundedReadPage(page: ReviewSourceReadResult): ReviewSourceReadResult {
	if (page.kind !== "loaded" || page.content.length <= SOURCE_PAGE_COLUMNS) return page;
	const lastNewline = page.content.lastIndexOf("\n", SOURCE_PAGE_COLUMNS - 1);
	if (lastNewline >= 0) return boundedLines(page, lastNewline + 1);
	return {
		...page,
		content: page.content.slice(0, SOURCE_PAGE_COLUMNS),
		endLine: page.startLine,
		endColumn: page.startColumn + SOURCE_PAGE_COLUMNS,
		nextRange: {
			kind: "columns",
			line: page.startLine,
			startColumn: page.startColumn + SOURCE_PAGE_COLUMNS,
			columnCount: SOURCE_PAGE_COLUMNS,
		},
	};
}

function boundedLines(page: ReviewSourceReadPage, end: number): ReviewSourceReadPage {
	const content = page.content.slice(0, end);
	const lines = content.split("\n");
	const endLine = page.startLine + lines.length - 2;
	return {
		...page,
		content,
		endLine,
		endColumn: (lines.at(-2)?.length ?? 0) + 1,
		nextRange: { kind: "lines", startLine: endLine + 1, lineCount: 200 },
	};
}

export interface ReviewRequiredSourceRead {
	readonly source: ReviewSourceReference;
	readonly columns: number;
	readonly reason: "diff_not_read" | "judge_evidence_not_read";
}

function coveredColumns(
	intervals: readonly { readonly start: number; readonly end: number }[],
): number {
	let covered = 0;
	for (const interval of [...intervals].sort((left, right) => left.start - right.start)) {
		if (interval.start > covered) break;
		covered = Math.max(covered, interval.end);
	}
	return covered;
}
