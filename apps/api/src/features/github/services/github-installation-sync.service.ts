import { z } from "zod";

import type { GitHubAccessRepository } from "../repositories/github-access.repository.js";
import type { RepositoryInput } from "../types/github-access.types.js";
import type { DeliveryOutcome } from "../types/webhook-delivery.types.js";
import { isAllowedGithubAccount } from "../utils/github-account.util.js";

const INSTALLATION_SCHEMA = z.object({
	id: z.number().int().positive(),
	account: z.object({ login: z.string().min(1) }).nullable(),
	suspended_at: z.string().nullable(),
});
const REPOSITORIES_PAGE_SCHEMA = z.object({
	total_count: z.number().int().nonnegative(),
	repositories: z.array(
		z.object({
			id: z.number().int().positive(),
			owner: z.object({ login: z.string().min(1) }),
			name: z.string().min(1),
			default_branch: z.string().min(1),
		}),
	),
});
const API_ERROR_SCHEMA = z.object({ status: z.number() });
const PAGE_SIZE = 100;

const MISSING_INSTALLATION_STATUSES: readonly number[] = [404, 410];
type Installation = z.infer<typeof INSTALLATION_SCHEMA>;
type RepositorySnapshot = Omit<RepositoryInput, "installationId" | "status">;

interface GitHubInstallationApp {
	auth(installationId?: number): Promise<{
		readonly rest: {
			readonly apps: {
				getInstallation(input: { installation_id: number }): Promise<{ data: unknown }>;
				listInstallations(input: {
					per_page: number;
					page: number;
				}): Promise<{ data: unknown }>;
				listReposAccessibleToInstallation(input: {
					per_page: number;
					page: number;
				}): Promise<{ data: unknown }>;
			};
		};
	}>;
	readonly log: {
		error(fields: { err: unknown; installationId?: number }, message: string): void;
	};
}

interface Synchronization {
	pending: Promise<DeliveryOutcome>;
	revision: number;
}

export class GitHubInstallationSyncService {
	// ponytail: in-process serialization is sufficient for the required single API replica.
	private readonly synchronizations = new Map<number, Synchronization>();

	constructor(
		private readonly app: GitHubInstallationApp,
		private readonly accessRepository: GitHubAccessRepository,
		private readonly allowedAccounts: ReadonlySet<string>,
	) {}

	async initialize(): Promise<void> {
		const installationIds = new Set(
			this.accessRepository
				.listInstallations()
				.filter((installation) =>
					isAllowedGithubAccount(installation.accountLogin, this.allowedAccounts),
				)
				.map((installation) => installation.githubInstallationId),
		);
		const discovered = await this.listInstallations().catch(
			(error: unknown): readonly Installation[] => {
				this.app.log.error({ err: error }, "github_installations.discovery_failed");
				return [];
			},
		);
		for (const installation of discovered) {
			if (this.isAllowed(installation)) installationIds.add(installation.id);
		}
		for (const installationId of installationIds) {
			try {
				await this.reconcile(installationId);
			} catch (error) {
				this.app.log.error(
					{ err: error, installationId },
					"github_installation.reconciliation_failed",
				);
			}
		}
	}

	reconcile(installationId: number): Promise<DeliveryOutcome> {
		const synchronization = this.synchronizationFor(installationId);
		const revision = ++synchronization.revision;
		const pending = synchronization.pending
			.catch(() => ignored("previous_sync_failed"))
			.then(() => this.reconcileCurrent(installationId, synchronization, revision));
		synchronization.pending = pending;
		return pending;
	}

	deactivate(installationId: number, status: "suspended" | "deleted"): void {
		++this.synchronizationFor(installationId).revision;
		this.accessRepository.setInstallationStatus(installationId, status);
	}

	private synchronizationFor(installationId: number): Synchronization {
		const existing = this.synchronizations.get(installationId);
		if (existing !== undefined) return existing;
		const synchronization = {
			pending: Promise.resolve<DeliveryOutcome>({ kind: "handled" }),
			revision: 0,
		};
		this.synchronizations.set(installationId, synchronization);
		return synchronization;
	}

	private async reconcileCurrent(
		installationId: number,
		synchronization: Synchronization,
		revision: number,
	): Promise<DeliveryOutcome> {
		if (synchronization.revision !== revision) return ignored("installation_sync_superseded");
		const installation = await this.getInstallation(installationId);
		if (synchronization.revision !== revision) return ignored("installation_sync_superseded");
		if (installation === null) {
			this.accessRepository.setInstallationStatus(installationId, "deleted");
			return { kind: "handled" };
		}
		return this.reconcileAccessible(installation, synchronization, revision);
	}

	private async reconcileAccessible(
		installation: Installation,
		synchronization: Synchronization,
		revision: number,
	): Promise<DeliveryOutcome> {
		if (!this.isAllowed(installation)) return ignored("github_account_not_allowed");
		const input = {
			githubInstallationId: installation.id,
			accountLogin: installation.account.login,
		};
		if (installation.suspended_at !== null) {
			this.accessRepository.upsertInstallation({ ...input, status: "suspended" });
			return { kind: "handled" };
		}
		const repositories = await this.listRepositories(installation.id);
		if (synchronization.revision !== revision) return ignored("installation_sync_superseded");
		this.accessRepository.reconcileInstallation({ ...input, status: "active" }, repositories);
		return { kind: "handled" };
	}

	private isAllowed(
		installation: Installation,
	): installation is Installation & { account: { login: string } } {
		return (
			installation.account !== null &&
			isAllowedGithubAccount(installation.account.login, this.allowedAccounts)
		);
	}

	private async getInstallation(installationId: number): Promise<Installation | null> {
		const octokit = await this.app.auth();
		try {
			const response = await octokit.rest.apps.getInstallation({
				installation_id: installationId,
			});
			const installation = INSTALLATION_SCHEMA.parse(response.data);
			if (installation.id !== installationId)
				throw new Error(
					"GitHub installation ID does not match the requested installation.",
				);
			return installation;
		} catch (error) {
			const parsed = API_ERROR_SCHEMA.safeParse(error);
			if (parsed.success && MISSING_INSTALLATION_STATUSES.includes(parsed.data.status))
				return null;
			throw error;
		}
	}

	private async listInstallations(): Promise<readonly Installation[]> {
		const octokit = await this.app.auth();
		const installations: Installation[] = [];
		for (let page = 1; ; page++) {
			const response = await octokit.rest.apps.listInstallations({
				per_page: PAGE_SIZE,
				page,
			});
			const batch = z.array(INSTALLATION_SCHEMA).parse(response.data);
			installations.push(...batch);
			if (batch.length < PAGE_SIZE) return installations;
		}
	}

	private async listRepositories(installationId: number): Promise<readonly RepositorySnapshot[]> {
		const octokit = await this.app.auth(installationId);
		const repositories = new Map<number, RepositorySnapshot>();
		let expectedCount: number | null = null;
		for (let page = 1; ; page++) {
			const response = await octokit.rest.apps.listReposAccessibleToInstallation({
				per_page: PAGE_SIZE,
				page,
			});
			const batch = REPOSITORIES_PAGE_SCHEMA.parse(response.data);
			expectedCount ??= batch.total_count;
			validateRepositoryPage(batch, expectedCount, repositories.size);
			appendRepositories(repositories, batch.repositories);
			if (repositories.size === expectedCount) return [...repositories.values()];
		}
	}
}

function appendRepositories(
	repositories: Map<number, RepositorySnapshot>,
	batch: z.infer<typeof REPOSITORIES_PAGE_SCHEMA>["repositories"],
): void {
	for (const repository of batch) {
		if (repositories.has(repository.id))
			throw new Error("GitHub repository inventory contains duplicate repositories.");
		repositories.set(repository.id, {
			githubRepositoryId: repository.id,
			ownerLogin: repository.owner.login,
			name: repository.name,
			defaultBranch: repository.default_branch,
		});
	}
}

function validateRepositoryPage(
	batch: z.infer<typeof REPOSITORIES_PAGE_SCHEMA>,
	expectedCount: number,
	collectedCount: number,
): void {
	if (batch.total_count !== expectedCount)
		throw new Error("GitHub repository inventory changed during pagination.");
	const nextCount = collectedCount + batch.repositories.length;
	if (nextCount > expectedCount) throw new Error("GitHub repository inventory is inconsistent.");
	if (batch.repositories.length === 0 && nextCount < expectedCount)
		throw new Error("GitHub repository inventory is incomplete.");
}

function ignored(reasonCode: string): DeliveryOutcome {
	return { kind: "ignored", reasonCode };
}
