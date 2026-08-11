import type { Context } from "probot";

import type { RequestReview } from "../review/review-run.js";

export type PullRequestEventName =
  | "pull_request.opened"
  | "pull_request.reopened"
  | "pull_request.ready_for_review"
  | "pull_request.synchronize";

export type PullRequestContext = Context<PullRequestEventName>;

export function isDraftPullRequest(context: PullRequestContext): boolean {
  return context.payload.pull_request.draft === true;
}

export function toRequestReview(
  context: PullRequestContext,
  trigger: RequestReview["trigger"],
): RequestReview | null {
  const { installation, pull_request: pullRequest, repository } = context.payload;
  if (installation === undefined) {
    return null;
  }

  return {
    deliveryId: context.id,
    installationId: installation.id,
    accountLogin: repository.owner.login,
    repositoryId: repository.id,
    repositoryOwner: repository.owner.login,
    repositoryName: repository.name,
    repositoryFullName: repository.full_name,
    repositoryDefaultBranch: repository.default_branch,
    pullRequestNumber: context.payload.number,
    headSha: pullRequest.head.sha,
    trigger,
  };
}
