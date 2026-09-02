import type { ReviewTrigger } from "@codekeat/database";
import type { ResolvedRepositoryPolicy } from "../repository-policy/repository-policy.js";

export type ReviewRunStatus = "queued" | "running" | "completed" | "failed" | "ignored";
export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type ReviewRunIgnoreReason = "repository_policy_disabled" | "superseded_head_sha";

export interface ReviewFinding {
  readonly severity: FindingSeverity;
  readonly path: string;
  readonly line: number;
  readonly title: string;
  readonly rationale: string;
}

export interface RequestReview {
  readonly deliveryId: string;
  readonly installationId: number;
  readonly accountLogin: string;
  readonly repositoryId: number;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly repositoryFullName: string;
  readonly repositoryDefaultBranch: string;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly trigger: ReviewTrigger;
}

export interface ReviewWorkQueue {
  enqueueReview(reviewRunId: string): Promise<void>;
  enqueueReport(reviewReportId: string): Promise<void>;
}

export interface ReviewRunProcessorTask {
  process(reviewRunId: string): Promise<void>;
}

export interface ReviewReportPublisherTask {
  publish(reviewReportId: string): Promise<void>;
}

export interface ReviewRequestResult {
  readonly kind: "queued" | "ignored" | "duplicate" | "report_queued";
  readonly policy: ResolvedRepositoryPolicy | null;
}
