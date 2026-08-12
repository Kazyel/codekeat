import { randomUUID } from "node:crypto";

import type { ExistingReviewRun, WebhookStore } from "@codekeat/database";

import type { ResolvedRepositoryPolicy } from "../repository-policy/repository-policy.js";
import type { RequestReview, ReviewRequestResult, ReviewWorkQueue } from "./review-run.js";

export interface RepositoryPolicyResolver {
  resolve(request: RequestReview): Promise<ResolvedRepositoryPolicy>;
}

export interface RequestReviewDependencies {
  readonly store: WebhookStore;
  readonly policyResolver: RepositoryPolicyResolver;
  readonly queue: ReviewWorkQueue;
}

export async function requestReview(
  request: RequestReview,
  dependencies: RequestReviewDependencies,
): Promise<ReviewRequestResult> {
  const policy = await dependencies.policyResolver.resolve(request);
  const existingRun = dependencies.store.findReviewRun(
    request.repositoryId,
    request.pullRequestNumber,
    request.headSha,
  );

  if (existingRun !== null) {
    return requestExistingReview(request, policy, existingRun, dependencies);
  }

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

  await dependencies.queue.enqueueReview(reviewRunId);
  return { kind: "queued", policy };
}

async function requestExistingReview(
  request: RequestReview,
  policy: ResolvedRepositoryPolicy,
  existingRun: ExistingReviewRun,
  dependencies: RequestReviewDependencies,
): Promise<ReviewRequestResult> {
  if (!policy.policy.enabled) {
    return { kind: "ignored", policy };
  }

  if (existingRun.status === "completed") {
    const reportId = dependencies.store.prepareReviewReport(existingRun.id, randomUUID());
    if (reportId === null) {
      return { kind: "duplicate", policy };
    }
    await dependencies.queue.enqueueReport(reportId);
    return { kind: "report_queued", policy };
  }

  if (request.trigger !== "reopened") {
    return { kind: "duplicate", policy };
  }

  if (existingRun.status === "failed" || existingRun.status === "ignored") {
    const requeued = dependencies.store.requeueReviewRun(existingRun.id, request.trigger);
    if (requeued) {
      await dependencies.queue.enqueueReview(existingRun.id);
      return { kind: "queued", policy };
    }
  }

  return { kind: "duplicate", policy };
}
