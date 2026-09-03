import { Buffer } from "node:buffer";

import { HTTP_STATUS_NOT_FOUND } from "#shared/http";

import {
	defaultRepositoryPolicy,
	type RepositoryPolicyLocation,
	type ResolvedRepositoryPolicy,
	resolveRepositoryPolicy,
} from "#features/repository-policy";
import { REPOSITORY_POLICY_FILE_PATH } from "../constants/github.constants.js";
import type { PullRequestContext } from "../types/github-events.types.js";

export class GitHubRepositoryPolicyService {
	constructor(private readonly context: PullRequestContext) {}

	async resolve(location: RepositoryPolicyLocation): Promise<ResolvedRepositoryPolicy> {
		try {
			const response = await this.context.octokit.rest.repos.getContent({
				owner: location.repositoryOwner,
				repo: location.repositoryName,
				path: REPOSITORY_POLICY_FILE_PATH,
				ref: location.repositoryDefaultBranch,
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
	return error.status === HTTP_STATUS_NOT_FOUND;
}
