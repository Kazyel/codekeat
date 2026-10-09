import { Effect } from "effect";

import type {
	ReviewEvidencePendingSource,
	ReviewSourceEvidenceRequest,
	ReviewSourceEvidenceResult,
	ReviewSupportingEvidenceRange,
} from "../types/review-evidence.types.js";
import type { ReviewSourceCatalog } from "../types/review-source.types.js";
import {
	reviewEvidenceSelectionNeedsContinuation,
	selectReviewEvidenceRange,
} from "../utils/review-evidence-range.util.js";

interface SupportingEvidence {
	readonly ranges: readonly ReviewSupportingEvidenceRange[];
	readonly pending: readonly ReviewEvidencePendingSource[];
	readonly gaps: readonly string[];
}

/** This is a response batch, not a repository limit. Every remaining exact source is returned. */
const SUPPORTING_BATCH_SIZE = 4;

export function loadReviewSupportingEvidence(
	sources: ReviewSourceCatalog,
	request: ReviewSourceEvidenceRequest,
	related: ReviewSourceEvidenceResult["localRelationships"],
	occurrences: ReviewSourceEvidenceResult["lexicalOccurrences"],
): Effect.Effect<SupportingEvidence> {
	return Effect.gen(function* () {
		const candidates = supportingCandidates(request, related, occurrences);
		const ranges = yield* Effect.forEach(
			candidates.slice(0, SUPPORTING_BATCH_SIZE),
			(candidate) => readSupportingRange(sources, candidate),
			{ concurrency: 4 },
		);
		const pending = candidates.slice(SUPPORTING_BATCH_SIZE);
		const gaps = supportingGaps(ranges, pending);
		return { ranges, pending, gaps };
	});
}

function supportingCandidates(
	request: ReviewSourceEvidenceRequest,
	related: ReviewSourceEvidenceResult["localRelationships"],
	occurrences: ReviewSourceEvidenceResult["lexicalOccurrences"],
): readonly ReviewEvidencePendingSource[] {
	const local = localCandidates(related);
	const lexical = lexicalCandidates(occurrences);
	const unique = new Map<string, ReviewEvidencePendingSource>();
	for (const candidate of [...local, ...lexical]) {
		if (candidate.source.path === request.source.path) continue;
		const key = JSON.stringify([
			candidate.source.role,
			candidate.source.path,
			candidate.source.repositoryFullName,
			candidate.source.revision,
		]);
		rememberCandidate(unique, key, candidate);
	}
	return [...unique.values()];
}

function rememberCandidate(
	unique: Map<string, ReviewEvidencePendingSource>,
	key: string,
	candidate: ReviewEvidencePendingSource,
): void {
	const existing = unique.get(key);
	if (existing === undefined) {
		unique.set(key, candidate);
		return;
	}
	if (existing.length === 0 && candidate.length > 0)
		unique.set(key, { ...candidate, relationship: existing.relationship });
}

function localCandidates(
	related: ReviewSourceEvidenceResult["localRelationships"],
): readonly ReviewEvidencePendingSource[] {
	if (related.kind !== "page") return [];
	return [...related.entries]
		.sort((a, b) => localPriority(a.path) - localPriority(b.path))
		.map((source) => ({
			source,
			line: 1,
			column: 0,
			length: 0,
			relationship: "local_import_or_test",
		}));
}

function localPriority(path: string): number {
	if (/\.(?:test|spec)\./.test(path)) return 0;
	return /(?:guard|validat|schema)/i.test(path) ? 1 : 2;
}

function lexicalCandidates(
	occurrences: ReviewSourceEvidenceResult["lexicalOccurrences"],
): readonly ReviewEvidencePendingSource[] {
	if (occurrences?.kind !== "page") return [];
	return occurrences.matches.map((match) => ({
		source: match.source,
		line: Math.max(1, match.line),
		column: match.column,
		length: match.length,
		relationship: "lexical_occurrence",
	}));
}

function supportingGaps(
	ranges: readonly ReviewSupportingEvidenceRange[],
	pending: readonly ReviewEvidencePendingSource[],
): string[] {
	const gaps: string[] = [];
	if (pending.length > 0) gaps.push("supporting_sources_pending");
	if (ranges.some((item) => item.range.page.kind !== "loaded"))
		gaps.push("supporting_source_unavailable");
	if (ranges.some((item) => reviewEvidenceSelectionNeedsContinuation(item.range)))
		gaps.push("supporting_range_needs_continuation");
	if (ranges.some(targetNotDelivered)) gaps.push("supporting_target_not_delivered");
	return gaps;
}

function targetNotDelivered(item: ReviewSupportingEvidenceRange): boolean {
	const page = item.range.page;
	if (page.kind !== "loaded") return false;
	if (page.endLine < item.line) return true;
	return page.endLine === item.line && page.endColumn < item.column + item.length;
}

function readSupportingRange(
	sources: ReviewSourceCatalog,
	candidate: ReviewEvidencePendingSource,
): Effect.Effect<ReviewSupportingEvidenceRange> {
	const request = {
		source: candidate.source,
		range: {
			kind: "lines" as const,
			startLine: Math.max(1, candidate.line - 20),
			lineCount: 60,
		},
	};
	const failure = {
		kind: "unavailable" as const,
		reason: "request_failed" as const,
		source: candidate.source,
	};
	return Effect.tryPromise({
		try: (signal) => sources.read(request, signal),
		catch: () => failure,
	}).pipe(
		Effect.catch((error) => Effect.succeed(error)),
		Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(failure) }),
		Effect.map((page) => ({
			...candidate,
			range: selectReviewEvidenceRange(page, candidate.line),
		})),
	);
}
