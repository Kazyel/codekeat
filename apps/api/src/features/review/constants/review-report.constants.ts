import type { FindingSeverity } from "../types/review-run.types.js";

export const FINDING_SEVERITY_ORDER: readonly FindingSeverity[] = [
	"critical",
	"high",
	"medium",
	"low",
];
export const SHORT_COMMIT_SHA_LENGTH = 7;
