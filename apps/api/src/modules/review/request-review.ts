import { randomUUID } from "node:crypto";

import type { WebhookStore } from "@codekeat/database";

import type { ResolvedRepositoryPolicy } from "../repository-policy/repository-policy.js";
import type { RequestReview, ReviewRequestResult, ReviewRunQueue } from "./review-run.js";

export interface RepositoryPolicyResolver {
  resolve(request: RequestReview): Promise<ResolvedRepositoryPolicy>;
}

export interface RequestReviewDependencies {
  readonly store: WebhookStore;
  readonly policyResolver: RepositoryPolicyResolver;
  readonly queue: ReviewRunQueue;
}

export async function requestReview(
  request: RequestReview,
  dependencies: RequestReviewDependencies,
): Promise<ReviewRequestResult> {
  const policy = await dependencies.policyResolver.resolve(request);
  const status = policy.policy.enabled ? "queued" : "ignored";
  const reviewRunId = randomUUID();

  const creation = dependencies.store.createReviewRun({
    id: reviewRunId,
    githubRepositoryId: request.repositoryId,
    pullRequestNumber: request.pullRequestNumber,
    headSha: request.headSha,
    trigger: request.trigger,
    status,
    policyJson: JSON.stringify(policy.policy),
    policySource: policy.source,
    policyWarningCode: policy.warningCode,
    ignoreReason: policy.policy.enabled ? null : "repository_policy_disabled",
  });

  if (creation === "duplicate") {
    return { kind: "duplicate", policy };
  }

  if (!policy.policy.enabled) {
    return { kind: "ignored", policy };
  }

  await dependencies.queue.enqueue(reviewRunId);
  return { kind: "queued", policy };
}
