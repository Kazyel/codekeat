import type { ReviewModelConfiguration } from "../../models/index.js";
import type { PolicySource } from "#features/repository-policy";
import type { FindingJudgment, ReviewTokenUsage } from "./review-input.types.js";
import type {
	FindingSeverity,
	ReviewRunIgnoreReason,
	ReviewRunStatus,
	ReviewTrigger,
} from "./review-run.types.js";

export type ReviewRunErrorCode =
	| "finding_location_invalid"
	| "gemini_invalid_response"
	| "gemini_judge_invalid_response"
	| "gemini_judge_request_failed"
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
	readonly judgeVerdict: "not_evaluated" | FindingJudgment["kind"];
	readonly judgeSeverity: FindingSeverity | null;
	readonly judgeRationale: string | null;
	readonly includedInReport: boolean;
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
	readonly findings: readonly StoredFinding[];
}
export interface ReviewRunCompletion {
	readonly reviewUsage: ReviewTokenUsage;
	readonly judgeUsage: ReviewTokenUsage;
	readonly findings: readonly StoredFinding[];
	readonly reviewReportId: string;
	readonly reviewStrategyVersion: string;
	readonly changedLineCount: number;
	readonly reviewChunkCount: number;
	readonly judgeCallCount: number;
	readonly processingDurationMs: number;
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
	readonly reviewStrategyVersion: string | null;
	readonly judgeUsage: ReviewTokenUsage | null;
	readonly changedLineCount: number | null;
	readonly reviewChunkCount: number | null;
	readonly judgeCallCount: number | null;
	readonly processingDurationMs: number | null;
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

export interface ReviewQualitySummary {
	readonly period: string;
	readonly repositoryFullName: string;
	readonly reviewStrategyVersion: string;
	readonly evaluatedFindingCount: number;
	readonly approvedFindingCount: number;
	readonly rejectedFindingCount: number;
	readonly severityChangedFindingCount: number;
	readonly acceptedFindingCount: number;
	readonly judgeApprovalRateBasisPoints: number | null;
	readonly acceptedFindingsPerThousandChangedLines: number | null;
	readonly changedLineCount: number;
	readonly completedRunCount: number;
	readonly reviewInputTokens: number;
	readonly reviewOutputTokens: number;
	readonly reviewCacheTokens: number;
	readonly reviewCostUsdMicros: number;
	readonly judgeInputTokens: number;
	readonly judgeOutputTokens: number;
	readonly judgeCacheTokens: number;
	readonly judgeCostUsdMicros: number;
	readonly judgeCallCount: number;
	readonly averageProcessingDurationMs: number;
}
