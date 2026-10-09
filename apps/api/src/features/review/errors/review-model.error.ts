export type ReviewModelResponseIssue =
	| "context_response_invalid"
	| "invalid_json"
	| "missing_text"
	| "schema_invalid"
	| "usage_metadata_invalid";

export class ReviewModelResponseError extends Error {
	constructor(readonly issue: ReviewModelResponseIssue) {
		super("The review model returned an invalid response.");
	}
}

export type ReviewConclusionValidationFailure =
	| {
			readonly code: "evidence_revision_mismatch" | "evidence_not_delivered";
			readonly hypothesisIndex: number;
			readonly evidenceIndex: number;
	  }
	| { readonly code: "evidence_receipt_invalid" }
	| {
			readonly code: "reviewed_path_missing" | "hypothesis_missing";
			readonly changedPathIndex: number;
	  }
	| { readonly code: "candidate_missing_finding"; readonly hypothesisIndex: number }
	| {
			readonly code: "finding_missing_candidate" | "finding_location_invalid";
			readonly findingIndex: number;
	  };

/** Carries only safe rule identifiers and host-generated array positions, never source text. */
export class ReviewConclusionValidationError extends ReviewModelResponseError {
	constructor(readonly failure: ReviewConclusionValidationFailure) {
		super("context_response_invalid");
	}
}
import { Data } from "effect";

export class ReviewContextCapacityExceeded extends Data.TaggedError(
	"ReviewContextCapacityExceeded",
)<{
	readonly inputTokens: number;
	readonly inputTokenLimit: number;
}> {}

export class ReviewSourceCoverageIncomplete extends Data.TaggedError(
	"ReviewSourceCoverageIncomplete",
)<{
	readonly reason: "diff_not_read" | "judge_evidence_not_read";
}> {}
