export type ReviewModelResponseIssue =
	| "invalid_json"
	| "missing_text"
	| "schema_invalid"
	| "usage_metadata_invalid";

export class ReviewModelResponseError extends Error {
	constructor(readonly issue: ReviewModelResponseIssue) {
		super("The review model returned an invalid response.");
	}
}
