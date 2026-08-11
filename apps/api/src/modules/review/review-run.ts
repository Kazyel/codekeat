import type { ReviewTrigger } from "@codekeat/database";

import type { ResolvedRepositoryPolicy } from "../repository-policy/repository-policy.js";

export type { ReviewTrigger } from "@codekeat/database";
export type ReviewRunStatus = "queued" | "running" | "completed" | "failed" | "ignored";
export type ReviewRunIgnoreReason = "repository_policy_disabled";

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

export interface ReviewRunQueue {
  enqueue(reviewRunId: string): Promise<void>;
}

export interface ReviewRequestResult {
  readonly kind: "queued" | "ignored" | "duplicate";
  readonly policy: ResolvedRepositoryPolicy | null;
}
