import { Cache, Effect, Exit } from "effect";
import { z } from "zod";

import type {
	ReviewBatchedSourceSearchResult,
	ReviewSourceEvidenceRequest,
	ReviewSourceEvidenceResult,
} from "../types/review-evidence.types.js";
import type {
	ReviewSourceCatalog,
	ReviewSourceIdentity,
	ReviewSourceReadResult,
	ReviewSourceSearchPage,
	ReviewSourceSearchRequest,
	ReviewSourceUnavailable,
} from "../types/review-source.types.js";
import {
	reviewEvidenceSelectionNeedsContinuation,
	selectReviewEvidenceRange,
} from "../utils/review-evidence-range.util.js";
import { loadReviewSupportingEvidence } from "./review-supporting-evidence.service.js";

const SEARCH_SCHEMA = z.object({
	role: z.enum(["head", "before", "pull_request", "investigation"]),
	prefix: z.string(),
	cursor: z.string().nullable(),
	limit: z.number().int().positive(),
	mode: z.enum(["path", "content"]),
	query: z.string().min(1),
	scanLimit: z.number().int().positive(),
});
const SEARCH_DEADLINE_MS = 10_000;
const LOOKUPS = new WeakMap<ReviewSourceCatalog, ReviewEvidenceRetrievalService>();

/** The catalog instance is the authorization boundary; no cache crosses catalogs or runs. */
export function reviewEvidenceRetrieval(
	sources: ReviewSourceCatalog,
): ReviewEvidenceRetrievalService {
	const existing = LOOKUPS.get(sources);
	if (existing !== undefined) return existing;
	const service = new ReviewEvidenceRetrievalService(sources);
	LOOKUPS.set(sources, service);
	return service;
}

export class ReviewEvidenceRetrievalService {
	private readonly searches: Cache.Cache<string, ReviewBatchedSourceSearchResult>;

	constructor(private readonly sources: ReviewSourceCatalog) {
		this.searches = Effect.runSync(
			Cache.makeWith(
				(key: string) => this.batchSearch(SEARCH_SCHEMA.parse(JSON.parse(key))),
				{
					capacity: 256,
					timeToLive: (exit) =>
						Exit.isSuccess(exit) &&
						exit.value.kind === "page" &&
						exit.value.status === "complete"
							? "10 minutes"
							: 0,
				},
			),
		);
	}

	search(request: ReviewSourceSearchRequest): Effect.Effect<ReviewBatchedSourceSearchResult> {
		if (request.role === "investigation") return this.batchSearch(request);
		return Cache.get(this.searches, JSON.stringify(request));
	}

	evidence(request: ReviewSourceEvidenceRequest): Effect.Effect<ReviewSourceEvidenceResult> {
		return Effect.gen({ self: this }, function* () {
			const sources = this.sources;
			const headRequest = { source: request.source, range: evidenceWindow(request.line) };
			const pages = yield* Effect.all(
				{
					head: timedLookup(
						(signal) => sources.read(headRequest, signal),
						sourceFailure(request.source),
					),
					before: this.readBefore(request),
					localRelationships: timedLookup(
						(signal) =>
							sources.related(
								{ source: request.source, cursor: null, limit: 50 },
								signal,
							),
						unavailable(),
					),
					lexicalOccurrences: this.searchOccurrences(request),
				},
				{ concurrency: 4 },
			);
			const head = selectReviewEvidenceRange(pages.head, request.line);
			const beforeRange =
				pages.before === null
					? null
					: selectReviewEvidenceRange(pages.before, request.beforeLine!);
			const gaps = evidenceGaps(
				head,
				beforeRange,
				pages.localRelationships,
				pages.lexicalOccurrences,
			);
			const supporting = yield* loadReviewSupportingEvidence(
				sources,
				request,
				pages.localRelationships,
				pages.lexicalOccurrences,
			);
			gaps.push(...supporting.gaps);
			if (request.beforeLine === null) gaps.push("before_position_not_provided");
			if (request.symbol === null) gaps.push("symbol_not_provided");
			return {
				kind: "evidence",
				status: gaps.length === 0 ? "complete" : "partial",
				head,
				before: beforeRange,
				localRelationships: pages.localRelationships,
				lexicalOccurrences: pages.lexicalOccurrences,
				supportingRanges: supporting.ranges,
				pendingSources: supporting.pending,
				gaps,
			};
		});
	}

	private readBefore(
		request: ReviewSourceEvidenceRequest,
	): Effect.Effect<ReviewSourceReadResult | null> {
		if (request.beforeLine === null) return Effect.succeed(null);
		const source = { role: "before" as const, path: request.source.path };
		const range = evidenceWindow(request.beforeLine);
		return timedLookup(
			(signal) => this.sources.read({ source, range }, signal),
			sourceFailure(source),
		);
	}

	private searchOccurrences(
		request: ReviewSourceEvidenceRequest,
	): Effect.Effect<ReviewBatchedSourceSearchResult | null> {
		if (request.symbol === null) return Effect.succeed(null);
		return this.search({
			role: request.source.role,
			prefix: request.prefix,
			cursor: null,
			limit: 50,
			mode: "content",
			query: request.symbol,
			scanLimit: 20,
		});
	}

	private batchSearch(
		request: ReviewSourceSearchRequest,
	): Effect.Effect<ReviewBatchedSourceSearchResult> {
		return Effect.suspend(() => {
			const progress: ReviewSourceSearchPage = {
				kind: "page",
				matches: [],
				scannedSources: 0,
				totalSources: 0,
				unavailable: [],
				nextCursor: request.cursor,
			};
			const state = { progress, pages: 0 };
			return this.scanPages(request, state).pipe(
				Effect.timeoutOrElse({
					duration: SEARCH_DEADLINE_MS,
					orElse: () => Effect.succeed(partial(state.progress, "deadline")),
				}),
			);
		});
	}

	private scanPages(
		request: ReviewSourceSearchRequest,
		state: { progress: ReviewSourceSearchPage; pages: number },
	): Effect.Effect<ReviewBatchedSourceSearchResult> {
		return Effect.gen({ self: this }, function* () {
			const cursors = new Set<string | null>();
			while (state.progress.matches.length < request.limit) {
				const cursor = state.progress.nextCursor;
				if (cursors.has(cursor)) return partial(state.progress, "cursor_stalled");
				cursors.add(cursor);
				const page = yield* lookup(
					(signal) =>
						this.sources.search(
							{
								...request,
								cursor,
								limit: request.limit - state.progress.matches.length,
							},
							signal,
						),
					unavailable(),
				);
				if (page.kind === "unavailable") return failedPage(state, page);
				state.pages++;
				state.progress = combinePages(state.progress, page, request.mode);
				if (page.nextCursor === null) return finish(state.progress);
			}
			return partial(state.progress, "result_limit");
		});
	}
}

function lookup<A>(request: (signal: AbortSignal) => Promise<A>, failure: A): Effect.Effect<A> {
	return Effect.tryPromise({ try: request, catch: () => failure }).pipe(
		Effect.catch((error) => Effect.succeed(error)),
	);
}

function timedLookup<A>(
	request: (signal: AbortSignal) => Promise<A>,
	failure: A,
): Effect.Effect<A> {
	return lookup(request, failure).pipe(
		Effect.timeoutOrElse({
			duration: SEARCH_DEADLINE_MS,
			orElse: () => Effect.succeed(failure),
		}),
	);
}

function unavailable(): ReviewSourceUnavailable {
	return { kind: "unavailable", reason: "request_failed" };
}

function sourceFailure(source: ReviewSourceIdentity): ReviewSourceReadResult {
	return { ...unavailable(), source };
}

function combinePages(
	previous: ReviewSourceSearchPage,
	page: ReviewSourceSearchPage,
	mode: ReviewSourceSearchRequest["mode"],
): ReviewSourceSearchPage {
	return {
		...page,
		matches: [...previous.matches, ...page.matches],
		unavailable: [...previous.unavailable, ...page.unavailable],
		scannedSources:
			mode === "path"
				? Math.max(previous.scannedSources, page.scannedSources)
				: previous.scannedSources + page.scannedSources,
	};
}

function partial(
	page: ReviewSourceSearchPage,
	incompleteReason: Extract<
		ReviewBatchedSourceSearchResult,
		{ readonly kind: "page" }
	>["incompleteReason"],
): ReviewBatchedSourceSearchResult {
	return { ...page, status: "partial", incompleteReason: incompleteReason ?? "request_failed" };
}

function finish(page: ReviewSourceSearchPage): ReviewBatchedSourceSearchResult {
	return page.unavailable.length === 0
		? { ...page, status: "complete", incompleteReason: null }
		: partial(page, "source_unavailable");
}

function evidenceWindow(line: number): {
	readonly kind: "lines";
	readonly startLine: number;
	readonly lineCount: number;
} {
	return { kind: "lines", startLine: Math.max(1, line - 60), lineCount: 200 };
}

function evidenceGaps(
	head: ReviewSourceEvidenceResult["head"],
	before: ReviewSourceEvidenceResult["before"],
	related: ReviewSourceEvidenceResult["localRelationships"],
	occurrences: ReviewSourceEvidenceResult["lexicalOccurrences"],
): string[] {
	const gaps = rangeGaps("head", head);
	if (before !== null) gaps.push(...rangeGaps("before", before));
	gaps.push(...relatedGaps(related), ...occurrenceGaps(occurrences));
	return gaps;
}

function relatedGaps(related: ReviewSourceEvidenceResult["localRelationships"]): string[] {
	if (related.kind === "unavailable") return ["local_relationships_unavailable"];
	return related.nextCursor === null ? [] : ["local_relationships_need_continuation"];
}

function occurrenceGaps(occurrences: ReviewSourceEvidenceResult["lexicalOccurrences"]): string[] {
	if (occurrences === null) return [];
	if (occurrences.kind === "unavailable") return ["lexical_occurrences_unavailable"];
	return occurrences.status === "partial"
		? [`lexical_occurrences_${occurrences.incompleteReason}`]
		: [];
}

function failedPage(
	state: { readonly progress: ReviewSourceSearchPage; readonly pages: number },
	failure: ReviewSourceUnavailable,
): ReviewBatchedSourceSearchResult {
	return state.pages === 0 ? failure : partial(state.progress, "request_failed");
}

function rangeGaps(role: string, range: ReviewSourceEvidenceResult["head"]): string[] {
	if (range.page.kind !== "loaded") return [`${role}_source_${range.page.kind}`];
	if (range.enclosure === "file_window") return [`${role}_function_enclosure_unverified`];
	if (reviewEvidenceSelectionNeedsContinuation(range))
		return [`${role}_function_needs_continuation`];
	return [];
}
