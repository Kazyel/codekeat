import type { RequestReview } from "#features/review";
import type { PullRequestContext } from "../types/github-events.types.js";

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
