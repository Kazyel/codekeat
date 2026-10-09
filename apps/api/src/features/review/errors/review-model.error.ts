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
