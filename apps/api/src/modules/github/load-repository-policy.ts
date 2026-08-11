import { Buffer } from "node:buffer";

import {
  defaultRepositoryPolicy,
  type ResolvedRepositoryPolicy,
  resolveRepositoryPolicy,
} from "../repository-policy/repository-policy.js";
import type { RepositoryPolicyResolver } from "../review/request-review.js";
import type { RequestReview } from "../review/review-run.js";
import type { PullRequestContext } from "./webhook-events.js";

const policyFilePath = ".codekeat.yml";

export class GitHubRepositoryPolicyResolver implements RepositoryPolicyResolver {
  constructor(private readonly context: PullRequestContext) {}

  async resolve(request: RequestReview): Promise<ResolvedRepositoryPolicy> {
    try {
      const response = await this.context.octokit.rest.repos.getContent({
        owner: request.repositoryOwner,
        repo: request.repositoryName,
        path: policyFilePath,
        ref: request.repositoryDefaultBranch,
      });

      return resolveContent(response.data);
    } catch (error) {
      if (isNotFound(error)) {
        return defaultRepositoryPolicy();
      }

      throw error;
    }
  }
}

function resolveContent(
  content: Awaited<
    ReturnType<PullRequestContext["octokit"]["rest"]["repos"]["getContent"]>
  >["data"],
): ResolvedRepositoryPolicy {
  if (Array.isArray(content) || content.type !== "file" || content.content === undefined) {
    return resolveRepositoryPolicy("");
  }

  return resolveRepositoryPolicy(Buffer.from(content.content, "base64").toString("utf8"));
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  return error.status === 404;
}
