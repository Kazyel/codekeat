import type { Context } from "probot";

import type { GitHubAccessRepository } from "../repositories/github-access.repository.js";
import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository.js";
import { processWebhookDelivery } from "../services/webhook-delivery.service.js";
import type { DeliveryOutcome } from "../types/webhook-delivery.types.js";
import { isAllowedGithubAccount } from "../utils/github-account.util.js";

type InstallationEventName =
	| "installation.created"
	| "installation.suspend"
	| "installation.unsuspend"
	| "installation.deleted"
	| "installation_repositories.added"
	| "installation_repositories.removed";

type InstallationContext = Context<InstallationEventName>;

interface InstallationDependencies {
	readonly accessRepository: GitHubAccessRepository;
	readonly deliveryRepository: WebhookDeliveryRepository;
	readonly allowedAccounts: ReadonlySet<string>;
}

interface GitHubRepository {
	readonly id: number;
	readonly name: string;
	readonly full_name: string;
}

export async function handleInstallationCreated(
	context: Context<"installation.created">,
	dependencies: InstallationDependencies,
): Promise<void> {
	await processWebhookDelivery(
		dependencies.deliveryRepository,
		deliveryFor(context),
		async () => {
			const installation = context.payload.installation;

			const accountLogin = allowedAccountLogin(installation.account, dependencies);
			if (accountLogin === null) {
				return ignored("github_account_not_allowed");
			}

			dependencies.accessRepository.upsertInstallation({
				githubInstallationId: installation.id,
				accountLogin,
				status: "active",
			});

			upsertRepositories(
				context.payload.repositories ?? [],
				installation.id,
				dependencies.accessRepository,
			);
			return handled();
		},
	);
}

export async function handleInstallationSuspended(
	context: Context<"installation.suspend">,
	dependencies: InstallationDependencies,
): Promise<void> {
	await updateInstallationStatus(context, dependencies, "suspended");
}

export async function handleInstallationUnsuspended(
	context: Context<"installation.unsuspend">,
	dependencies: InstallationDependencies,
): Promise<void> {
	await processWebhookDelivery(
		dependencies.deliveryRepository,
		deliveryFor(context),
		async () => {
			const installation = context.payload.installation;

			const accountLogin = allowedAccountLogin(installation.account, dependencies);
			if (accountLogin === null) {
				return ignored("github_account_not_allowed");
			}

			dependencies.accessRepository.upsertInstallation({
				githubInstallationId: installation.id,
				accountLogin,
				status: "active",
			});
			return handled();
		},
	);
}

export async function handleInstallationDeleted(
	context: Context<"installation.deleted">,
	dependencies: InstallationDependencies,
): Promise<void> {
	await updateInstallationStatus(context, dependencies, "deleted");
}

export async function handleRepositoriesAdded(
	context: Context<"installation_repositories.added">,
	dependencies: InstallationDependencies,
): Promise<void> {
	await processWebhookDelivery(
		dependencies.deliveryRepository,
		deliveryFor(context),
		async () => {
			const installation = dependencies.accessRepository.findInstallation(
				context.payload.installation.id,
			);
			if (installation?.status !== "active") {
				return ignored("installation_not_active");
			}

			upsertRepositories(
				context.payload.repositories_added,
				context.payload.installation.id,
				dependencies.accessRepository,
			);
			return handled();
		},
	);
}

export async function handleRepositoriesRemoved(
	context: Context<"installation_repositories.removed">,
	dependencies: InstallationDependencies,
): Promise<void> {
	await processWebhookDelivery(
		dependencies.deliveryRepository,
		deliveryFor(context),
		async () => {
			const installation = dependencies.accessRepository.findInstallation(
				context.payload.installation.id,
			);
			if (installation === null) {
				return ignored("installation_not_active");
			}

			for (const repository of context.payload.repositories_removed) {
				dependencies.accessRepository.setRepositoryStatus(repository.id, "removed");
			}

			return handled();
		},
	);
}

async function updateInstallationStatus(
	context: Context<"installation.suspend" | "installation.deleted">,
	dependencies: InstallationDependencies,
	status: "suspended" | "deleted",
): Promise<void> {
	await processWebhookDelivery(
		dependencies.deliveryRepository,
		deliveryFor(context),
		async () => {
			dependencies.accessRepository.setInstallationStatus(
				context.payload.installation.id,
				status,
			);
			return handled();
		},
	);
}

function deliveryFor(context: InstallationContext): {
	deliveryId: string;
	eventName: string;
	installationId: number;
} {
	return {
		deliveryId: context.id,
		eventName: context.name,
		installationId: context.payload.installation.id,
	};
}

function allowedAccountLogin(
	account: Context<"installation.created">["payload"]["installation"]["account"],
	dependencies: InstallationDependencies,
): string | null {
	if (account === null || !("login" in account)) {
		return null;
	}

	return isAllowedGithubAccount(account.login, dependencies.allowedAccounts)
		? account.login
		: null;
}

function upsertRepositories(
	githubRepositories: readonly GitHubRepository[],
	installationId: number,
	accessRepository: GitHubAccessRepository,
): void {
	for (const repository of githubRepositories) {
		accessRepository.upsertRepository({
			githubRepositoryId: repository.id,
			installationId,
			ownerLogin: ownerFromFullName(repository.full_name),
			name: repository.name,
			defaultBranch: "unknown",
			status: "active",
		});
	}
}

function ownerFromFullName(fullName: string): string {
	const separatorIndex = fullName.indexOf("/");
	return fullName.slice(0, separatorIndex);
}

function handled(): DeliveryOutcome {
	return { kind: "handled" };
}

function ignored(reasonCode: string): DeliveryOutcome {
	return { kind: "ignored", reasonCode };
}
