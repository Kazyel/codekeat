import type { ReviewModelConfiguration } from "../../models/index.js";
import type { PolicySource } from "#features/repository-policy";
import type { ReviewTokenUsage } from "./review-input.types.js";
import type {
	FindingSeverity,
	ReviewRunIgnoreReason,
	ReviewRunStatus,
	ReviewTrigger,
} from "./review-run.types.js";

export type ReviewRunErrorCode =
	| "finding_location_invalid"
	| "gemini_invalid_response"
	| "gemini_request_failed"
	| "github_diff_file_limit_exceeded"
	| "github_diff_unavailable";
export type ReviewReportStatus = "pending" | "publishing" | "published" | "failed";
export type ReviewReportErrorCode = "github_comment_unavailable";

export interface ReviewRunInput {
	readonly id: string;
	readonly githubRepositoryId: number;
	readonly pullRequestNumber: number;
	readonly headSha: string;
	readonly trigger: ReviewTrigger;
	readonly status: ReviewRunStatus;
	readonly policyJson: string;
	readonly policySource: PolicySource;
	readonly policyWarningCode: string | null;
	readonly ignoreReason: ReviewRunIgnoreReason | null;
	readonly model: ReviewModelConfiguration;
}

export interface StoredFinding {
	readonly id: string;
	readonly severity: FindingSeverity;
	readonly path: string;
	readonly line: number;
	readonly title: string;
	readonly rationale: string;
}

export interface ExistingReviewRun {
	readonly id: string;
	readonly status: ReviewRunStatus;
}

export interface RunnableReviewRun {
	readonly id: string;
	readonly githubInstallationId: number;
	readonly githubInstallationAccountLogin: string;
	readonly repositoryOwner: string;
	readonly repositoryName: string;
	readonly repositoryFullName: string;
	readonly pullRequestNumber: number;
	readonly headSha: string;
	readonly model: ReviewModelConfiguration;
}

export interface ReviewReportComment {
	readonly githubCommentId: number;
	readonly githubCommentUrl: string;
}

export interface PublishableReviewReport {
	readonly reportId: string;
	readonly reviewRunId: string;
	readonly githubInstallationId: number;
	readonly repositoryOwner: string;
	readonly repositoryName: string;
	readonly repositoryFullName: string;
	readonly pullRequestNumber: number;
	readonly headSha: string;
	readonly githubCommentId: number | null;
	readonly findings: readonly StoredFinding[];
}

export interface ReviewRunSummary {
	readonly id: string;
	readonly repositoryFullName: string;
	readonly pullRequestNumber: number;
	readonly headSha: string;
	readonly trigger: ReviewTrigger;
	readonly status: ReviewRunStatus;
	readonly modelName: string | null;
	readonly findingCount: number;
	readonly createdAt: string;
	readonly completedAt: string | null;
	readonly usage: ReviewTokenUsage | null;
	readonly reviewReportStatus: ReviewReportStatus | null;
	readonly githubCommentUrl: string | null;
}

export interface ReviewRunDetail extends ReviewRunSummary {
	readonly policySource: PolicySource;
	readonly policyWarningCode: string | null;
	readonly ignoreReason: string | null;
	readonly errorCode: string | null;
	readonly findings: readonly StoredFinding[];
}

export type ReviewUsageGroup = "day" | "week" | "month";

export interface ReviewUsageSummary {
	readonly period: string;
	readonly repositoryFullName: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheTokens: number;
	readonly costUsdMicros: number;
}
