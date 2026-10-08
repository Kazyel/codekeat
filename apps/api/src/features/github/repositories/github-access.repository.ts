import {
	installations,
	repositories,
	reviewRuns,
	type DatabaseConnection,
} from "@codekeat/database";
import { and, asc, desc, eq, notExists } from "drizzle-orm";
import { currentTimestamp } from "#shared/database";

import type {
	GitHubInstallationSummary,
	GitHubRepositoryAccessSummary,
	InstallationInput,
	InstallationStatus,
	RepositoryInput,
	RepositoryStatus,
	StoredInstallation,
	StoredRepository,
} from "../types/github-access.types.js";

export class GitHubAccessRepository {
	constructor(private readonly connection: DatabaseConnection) {}

	listInstallations(): readonly InstallationInput[] {
		return this.connection.db
			.select({
				githubInstallationId: installations.githubInstallationId,
				accountLogin: installations.accountLogin,
				status: installations.status,
			})
			.from(installations)
			.all();
	}

	reconcileInstallation(
		installation: InstallationInput,
		snapshot: readonly Omit<RepositoryInput, "installationId" | "status">[],
	): void {
		this.connection.db.transaction((transaction) => {
			this.upsertInstallation(installation);
			transaction
				.update(repositories)
				.set({ status: "removed", updatedAt: currentTimestamp() })
				.where(eq(repositories.installationId, installation.githubInstallationId))
				.run();
			for (const repository of snapshot) {
				this.upsertRepository({
					...repository,
					installationId: installation.githubInstallationId,
					status: "active",
				});
			}
			this.deleteRemovedRepositoriesWithoutReviews(installation.githubInstallationId);
		});
	}

	listInstallationSummaries(): readonly GitHubInstallationSummary[] {
		const repositoriesByInstallation = new Map<number, GitHubRepositoryAccessSummary[]>();

		const installationRows = this.connection.db
			.select({
				githubInstallationId: installations.githubInstallationId,
				accountLogin: installations.accountLogin,
				status: installations.status,
				updatedAt: installations.updatedAt,
			})
			.from(installations)
			.orderBy(
				asc(installations.accountLogin),
				desc(installations.updatedAt),
				asc(installations.githubInstallationId),
			)
			.all();

		const repositoryRows = this.connection.db
			.select({
				githubRepositoryId: repositories.githubRepositoryId,
				installationId: repositories.installationId,
				ownerLogin: repositories.ownerLogin,
				name: repositories.name,
				defaultBranch: repositories.defaultBranch,
				status: repositories.status,
				updatedAt: repositories.updatedAt,
			})
			.from(repositories)
			.orderBy(
				asc(repositories.ownerLogin),
				asc(repositories.name),
				asc(repositories.githubRepositoryId),
			)
			.all();

		for (const row of repositoryRows) {
			const repository = {
				githubRepositoryId: row.githubRepositoryId,
				fullName: `${row.ownerLogin}/${row.name}`,
				defaultBranch: row.defaultBranch === "unknown" ? null : row.defaultBranch,
				status: row.status,
				updatedAt: row.updatedAt,
			} satisfies GitHubRepositoryAccessSummary;
			const installationRepositories = repositoriesByInstallation.get(row.installationId);

			if (installationRepositories === undefined) {
				repositoriesByInstallation.set(row.installationId, [repository]);
				continue;
			}
			installationRepositories.push(repository);
		}

		return installationRows.map((installation) => ({
			...installation,
			repositories: repositoriesByInstallation.get(installation.githubInstallationId) ?? [],
		}));
	}

	upsertInstallation(input: InstallationInput): void {
		const now = currentTimestamp();
		this.connection.db
			.insert(installations)
			.values({ ...input, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: installations.githubInstallationId,
				set: {
					accountLogin: input.accountLogin,
					status: input.status,
					updatedAt: now,
				},
			})
			.run();
	}

	setInstallationStatus(githubInstallationId: number, status: InstallationStatus): void {
		this.connection.db.transaction((transaction) => {
			transaction
				.update(installations)
				.set({ status, updatedAt: currentTimestamp() })
				.where(eq(installations.githubInstallationId, githubInstallationId))
				.run();
			if (status !== "deleted") return;

			transaction
				.update(repositories)
				.set({ status: "removed", updatedAt: currentTimestamp() })
				.where(eq(repositories.installationId, githubInstallationId))
				.run();
			this.deleteRemovedRepositoriesWithoutReviews(githubInstallationId);
		});
	}

	findInstallation(githubInstallationId: number): StoredInstallation | null {
		const row = this.connection.db
			.select({ status: installations.status })
			.from(installations)
			.where(eq(installations.githubInstallationId, githubInstallationId))
			.get();

		return row ?? null;
	}

	upsertRepository(input: RepositoryInput): void {
		const now = currentTimestamp();
		this.connection.db
			.insert(repositories)
			.values({ ...input, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: repositories.githubRepositoryId,
				set: {
					installationId: input.installationId,
					ownerLogin: input.ownerLogin,
					name: input.name,
					defaultBranch: input.defaultBranch,
					status: input.status,
					updatedAt: now,
				},
			})
			.run();
	}

	setRepositoryStatus(githubRepositoryId: number, status: RepositoryStatus): void {
		this.connection.db
			.update(repositories)
			.set({ status, updatedAt: currentTimestamp() })
			.where(eq(repositories.githubRepositoryId, githubRepositoryId))
			.run();
	}

	findRepository(githubRepositoryId: number, installationId: number): StoredRepository | null {
		const row = this.connection.db
			.select({ defaultBranch: repositories.defaultBranch, status: repositories.status })
			.from(repositories)
			.where(
				and(
					eq(repositories.githubRepositoryId, githubRepositoryId),
					eq(repositories.installationId, installationId),
				),
			)
			.get();

		return row ?? null;
	}

	private deleteRemovedRepositoriesWithoutReviews(installationId: number): void {
		const history = this.connection.db
			.select({ id: reviewRuns.id })
			.from(reviewRuns)
			.where(eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId));

		this.connection.db
			.delete(repositories)
			.where(
				and(
					eq(repositories.installationId, installationId),
					eq(repositories.status, "removed"),
					notExists(history),
				),
			)
			.run();
	}
}
