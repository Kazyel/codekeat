import type {
	ReviewSourceIdentity,
	ReviewSourceListPage,
	ReviewSourceReadResult,
	ReviewSourceReference,
	ReviewSourceSearchPage,
	ReviewSourceUnavailable,
} from "./review-source.types.js";

export type ReviewSearchIncompleteReason =
	| "result_limit"
	| "deadline"
	| "source_unavailable"
	| "cursor_stalled"
	| "request_failed";

export type ReviewBatchedSourceSearchResult =
	| (ReviewSourceSearchPage &
			(
				| { readonly status: "complete"; readonly incompleteReason: null }
				| {
						readonly status: "partial";
						readonly incompleteReason: ReviewSearchIncompleteReason;
				  }
			))
	| ReviewSourceUnavailable;

export interface ReviewSourceEvidenceRequest {
	readonly source: ReviewSourceIdentity & { readonly role: "head" };
	readonly line: number;
	/** The caller supplies the before position; head line numbers are not a verified mapping. */
	readonly beforeLine: number | null;
	readonly symbol: string | null;
	readonly prefix: string;
}

export interface ReviewEvidenceRange {
	readonly enclosure: "function" | "file_window";
	readonly selection: {
		readonly startLine: number;
		readonly endLine: number;
		readonly endColumn: number;
	} | null;
	readonly page: ReviewSourceReadResult;
}

export interface ReviewEvidencePendingSource {
	readonly source: ReviewSourceReference;
	readonly line: number;
	readonly column: number;
	readonly length: number;
	readonly relationship: "local_import_or_test" | "lexical_occurrence";
}

export interface ReviewSupportingEvidenceRange extends ReviewEvidencePendingSource {
	readonly range: ReviewEvidenceRange;
}

export interface ReviewSourceEvidenceResult {
	readonly kind: "evidence";
	readonly status: "complete" | "partial";
	readonly head: ReviewEvidenceRange;
	readonly before: ReviewEvidenceRange | null;
	readonly localRelationships: ReviewSourceListPage | ReviewSourceUnavailable;
	/** Literal occurrences do not establish symbol identity or semantic callers. */
	readonly lexicalOccurrences: ReviewBatchedSourceSearchResult | null;
	readonly supportingRanges: readonly ReviewSupportingEvidenceRange[];
	readonly pendingSources: readonly ReviewEvidencePendingSource[];
	readonly gaps: readonly string[];
}
