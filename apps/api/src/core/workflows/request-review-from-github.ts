import {
	requestReview,
	type RequestReview,
	ReviewReportRepository,
	type ReviewRequestResult,
	ReviewRunRepository,
	type ReviewWorkQueue,
} from "#features/review";
import type { ModelCatalogRepository } from "../../features/models/index.js";
import {
	GitHubAccessRepository,
	type GitHubInstallationSyncService,
	GitHubRepositoryPolicyService,
	isAllowedGithubAccount,
	processWebhookDelivery,
	type WebhookDelivery,
	WebhookDeliveryRepository,
} from "#features/github";

export interface GitHubReviewEvent {
	readonly delivery: WebhookDelivery;
	readonly isDraft: boolean;
	readonly pullRequestState: "open" | "closed";
	readonly request: RequestReview | null;
}

export interface GitHubReviewWorkflowDependencies {
	readonly allowedAccounts: ReadonlySet<string>;
	readonly deliveryRepository: WebhookDeliveryRepository;
	readonly policyService: Pick<GitHubRepositoryPolicyService, "resolve">;
	readonly accessRepository: GitHubAccessRepository;
	readonly installationSync: Pick<GitHubInstallationSyncService, "ensureRepositoryAccess">;
	readonly reportRepository: ReviewReportRepository;
	readonly modelRepository: ModelCatalogRepository;
	readonly runRepository: ReviewRunRepository;
	readonly queue: ReviewWorkQueue;
}

export interface GitHubReviewWorkflowResult {
	readonly delivery: "processed" | "duplicate";
	readonly policyWarningCode: string | null;
}

export async function requestReviewFromGithub(
	event: GitHubReviewEvent,
	dependencies: GitHubReviewWorkflowDependencies,
): Promise<GitHubReviewWorkflowResult> {
	let policyWarningCode: string | null = null;

	const delivery = await processWebhookDelivery(
		dependencies.deliveryRepository,
		event.delivery,
		async () => {
			if (event.request === null) {
				return { kind: "ignored", reasonCode: "installation_not_active" };
			}

			const ignoreReason = await preparePullRequestRepository(
				{
					isDraft: event.isDraft,
					pullRequestState: event.pullRequestState,
					request: event.request,
				},
				dependencies,
			);
			if (ignoreReason !== null) {
				return { kind: "ignored", reasonCode: ignoreReason };
			}

			const policy = await dependencies.policyService.resolve({
				repositoryOwner: event.request.repositoryOwner,
				repositoryName: event.request.repositoryName,
				repositoryDefaultBranch: event.request.repositoryDefaultBranch,
			});
			const result = await requestReview(event.request, policy, {
				runRepository: dependencies.runRepository,
				modelRepository: dependencies.modelRepository,
				reportRepository: dependencies.reportRepository,
				queue: dependencies.queue,
			});

			policyWarningCode = getPolicyWarningCode(result);
			return { kind: "handled" };
		},
	);

	return { delivery, policyWarningCode };
}

export async function preparePullRequestRepository(
	event: {
		readonly isDraft: boolean;
		readonly pullRequestState: "open" | "closed";
		readonly request: RequestReview;
	},
	dependencies: Pick<
		GitHubReviewWorkflowDependencies,
		"accessRepository" | "allowedAccounts" | "installationSync"
	>,
): Promise<string | null> {
	if (event.pullRequestState === "closed") {
		return "closed_pull_request";
	}

	if (event.isDraft) {
		return "draft_pull_request";
	}

	if (!isAllowedGithubAccount(event.request.accountLogin, dependencies.allowedAccounts)) {
		return "github_account_not_allowed";
	}

	await dependencies.installationSync.ensureRepositoryAccess(
		event.request.installationId,
		event.request.repositoryId,
	);
	return getRepositoryAccessIgnoreReason(event.request, dependencies.accessRepository);
}

function getRepositoryAccessIgnoreReason(
	request: RequestReview,
	accessRepository: GitHubAccessRepository,
): "installation_not_active" | "repository_not_active" | null {
	if (accessRepository.findInstallation(request.installationId)?.status !== "active") {
		return "installation_not_active";
	}
	const repository = accessRepository.findRepository(
		request.repositoryId,
		request.installationId,
	);
	return repository?.status === "active" ? null : "repository_not_active";
}

function getPolicyWarningCode(result: ReviewRequestResult): string | null {
	if (result.policy === null) {
		return null;
	}
	return result.policy.warningCode;
}
