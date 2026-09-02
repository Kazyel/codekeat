import type { Probot } from "probot";

import type { RequestReview } from "#features/review";
import type { GitHubAccessRepository } from "../repositories/github-access.repository.js";
import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository.js";
import { GitHubRepositoryPolicyService } from "../services/github-repository-policy.service.js";
import type { PullRequestContext } from "../types/github-events.types.js";
import type { WebhookDelivery } from "../types/webhook-delivery.types.js";
import { isDraftPullRequest, toRequestReview } from "../utils/github-webhook.util.js";
import {
	handleInstallationCreated,
	handleInstallationDeleted,
	handleInstallationSuspended,
	handleInstallationUnsuspended,
	handleRepositoriesAdded,
	handleRepositoriesRemoved,
} from "./github-installation.controller.js";

interface PullRequestReviewEvent {
	readonly delivery: WebhookDelivery;
	readonly isDraft: boolean;
	readonly request: RequestReview | null;
}

interface PullRequestReviewResult {
	readonly policyWarningCode: string | null;
}

export interface WebhookDependencies {
	readonly accessRepository: GitHubAccessRepository;
	readonly deliveryRepository: WebhookDeliveryRepository;
	readonly allowedAccounts: ReadonlySet<string>;
	readonly requestReview: (
		event: PullRequestReviewEvent,
		policyService: GitHubRepositoryPolicyService,
	) => Promise<PullRequestReviewResult>;
}

export function registerGitHubWebhookController(
	app: Probot,
	dependencies: WebhookDependencies,
): void {
	registerInstallationHandlers(app, dependencies);

	app.on("pull_request.opened", (context) => handlePullRequest(context, dependencies, "opened"));
	app.on("pull_request.reopened", (context) =>
		handlePullRequest(context, dependencies, "reopened"),
	);

	app.on("pull_request.ready_for_review", (context) =>
		handlePullRequest(context, dependencies, "ready_for_review"),
	);

	app.on("pull_request.synchronize", (context) =>
		handlePullRequest(context, dependencies, "synchronize"),
	);
}

function registerInstallationHandlers(app: Probot, dependencies: WebhookDependencies): void {
	const installationDependencies = {
		accessRepository: dependencies.accessRepository,
		deliveryRepository: dependencies.deliveryRepository,
		allowedAccounts: dependencies.allowedAccounts,
	};

	app.on("installation.created", (context) =>
		handleInstallationCreated(context, installationDependencies),
	);
	app.on("installation.suspend", (context) =>
		handleInstallationSuspended(context, installationDependencies),
	);
	app.on("installation.unsuspend", (context) =>
		handleInstallationUnsuspended(context, installationDependencies),
	);
	app.on("installation.deleted", (context) =>
		handleInstallationDeleted(context, installationDependencies),
	);
	app.on("installation_repositories.added", (context) =>
		handleRepositoriesAdded(context, installationDependencies),
	);
	app.on("installation_repositories.removed", (context) =>
		handleRepositoriesRemoved(context, installationDependencies),
	);
}

async function handlePullRequest(
	context: PullRequestContext,
	dependencies: WebhookDependencies,
	trigger: "opened" | "reopened" | "ready_for_review" | "synchronize",
): Promise<void> {
	const result = await dependencies.requestReview(
		{
			delivery: {
				deliveryId: context.id,
				eventName: `pull_request.${trigger}`,
				installationId: context.payload.installation?.id ?? null,
			},
			isDraft: isDraftPullRequest(context),
			request: toRequestReview(context, trigger),
		},
		new GitHubRepositoryPolicyService(context),
	);

	logPolicyWarning(context, result.policyWarningCode);
}

function logPolicyWarning(context: PullRequestContext, warningCode: string | null): void {
	if (warningCode === null) {
		return;
	}
	context.log.warn(
		{ deliveryId: context.id, repository: context.payload.repository.full_name, warningCode },
		"repository_policy.invalid_using_default",
	);
}
