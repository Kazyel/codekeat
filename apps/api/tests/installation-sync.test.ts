import { Probot } from "probot";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubInstallationSyncService } from "#features/github";
import {
	requestReviewFromGithub,
	type GitHubReviewWorkflowDependencies,
} from "#core/workflows/request-review-from-github";
import { createTestDatabase, type TestDatabase } from "./test-database.js";
import { registerGitHubInstallationHandlers } from "../src/features/github/controllers/github-installation.controller.js";

interface Installation {
	id: number;
	account: { login: string };
	suspended_at: string | null;
	repository_selection: "all" | "selected";
}
interface Repository {
	id: number;
	owner: { login: string };
	name: string;
	default_branch: string;
}

class GitHubInventoryApp {
	readonly installations = new Map<number, Installation>();
	readonly repositories = new Map<number, Repository[]>();
	readonly log = { error: vi.fn() };

	async auth(installationId?: number) {
		return {
			rest: {
				apps: {
					getInstallation: async ({ installation_id }: { installation_id: number }) => {
						if (installationId !== undefined)
							throw new Error("Installation metadata requires app authentication");
						const installation = this.installations.get(installation_id);
						if (installation === undefined)
							throw Object.assign(new Error("Not found"), { status: 404 });
						return { data: installation };
					},
					listInstallations: async ({
						page,
						per_page,
					}: {
						page: number;
						per_page: number;
					}) => {
						if (installationId !== undefined)
							throw new Error("Discovery requires app authentication");
						return {
							data: [...this.installations.values()].slice(
								(page - 1) * per_page,
								page * per_page,
							),
						};
					},
					listReposAccessibleToInstallation: async ({
						page,
					}: {
						page: number;
						per_page: number;
					}) => {
						if (installationId === undefined)
							throw new Error("Inventory requires installation authentication");
						return this.readRepositories(installationId, page);
					},
				},
			},
		};
	}

	async readRepositories(installationId: number, page: number) {
		const repositories = this.repositories.get(installationId) ?? [];
		return {
			data: {
				total_count: repositories.length,
				repositories: repositories.slice((page - 1) * 100, page * 100),
			},
		};
	}
}

const databases: TestDatabase[] = [];
afterEach(() => {
	for (const database of databases.splice(0)) database.close();
	vi.restoreAllMocks();
});

function setup() {
	const database = createTestDatabase();
	databases.push(database);
	const app = new GitHubInventoryApp();
	app.installations.set(1, installation(1));
	return {
		database,
		app,
		service: new GitHubInstallationSyncService(
			app,
			database.githubAccessRepository,
			new Set(["takeat"]),
		),
	};
}

function installation(id: number): Installation {
	return {
		id,
		account: { login: "takeat" },
		suspended_at: null,
		repository_selection: "selected",
	};
}

function repository(id: number): Repository {
	return { id, owner: { login: "takeat" }, name: `repository-${id}`, default_branch: "trunk" };
}

describe("GitHub installation inventory", () => {
	it("waits for the newest inventory before reviewing a concurrently added repository", async () => {
		const { app, database, service } = setup();
		app.repositories.set(1, [repository(10)]);
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const readPage = app.readRepositories.bind(app);
		vi.spyOn(app, "readRepositories").mockImplementationOnce(async (id, page) => {
			const snapshot = await readPage(id, page);
			started.resolve();
			await release.promise;
			return snapshot;
		});
		const originalSync = service.reconcile(1);
		await started.promise;
		app.repositories.set(1, [repository(11)]);
		const newestSync = service.reconcile(1);
		const dependencies = reviewDependencies(database, service);
		const review = requestReviewFromGithub(reviewEvent(11), dependencies);
		release.resolve();

		await Promise.all([originalSync, newestSync, review]);

		expect(database.githubAccessRepository.findRepository(10, 1)).toBeNull();
		expect(database.githubAccessRepository.findRepository(11, 1)?.status).toBe("active");
		expect(dependencies.queue.enqueueReview).toHaveBeenCalledOnce();
	});

	it("verifies unknown pull request access with GitHub instead of trusting its payload", async () => {
		const { app, database, service } = setup();
		app.repositories.set(1, [repository(10)]);
		const dependencies = reviewDependencies(database, service);

		await requestReviewFromGithub(reviewEvent(10), dependencies);

		expect(database.githubAccessRepository.findRepository(10, 1)?.status).toBe("active");
		expect(dependencies.queue.enqueueReview).toHaveBeenCalledOnce();
	});

	it.each(["restored", "revoked"] as const)(
		"confirms %s repository access for a review arriving before its inventory delivery",
		async (access) => {
			const { app, database, service } = setup();
			app.repositories.set(1, [repository(10)]);
			await service.reconcile(1);
			database.reviewRunRepository.createReviewRun({
				id: "historical-run",
				githubRepositoryId: 10,
				pullRequestNumber: 99,
				headSha: "a".repeat(40),
				trigger: "opened",
				status: "queued",
				policyJson: '{"enabled":true,"version":1}',
				policySource: "default",
				policyWarningCode: null,
				ignoreReason: null,
				model: database.selectedModel,
			});
			app.repositories.set(1, []);
			await service.reconcile(1);
			expect(database.githubAccessRepository.findRepository(10, 1)?.status).toBe("removed");
			if (access === "restored") app.repositories.set(1, [repository(10)]);
			const dependencies = reviewDependencies(database, service);

			await requestReviewFromGithub(reviewEvent(10), dependencies);

			expect(database.githubAccessRepository.findRepository(10, 1)?.status).toBe(
				access === "restored" ? "active" : "removed",
			);
			expect(dependencies.queue.enqueueReview).toHaveBeenCalledTimes(
				access === "restored" ? 1 : 0,
			);
		},
	);

	it("waits for an authorized reactivation before reviewing a suspended installation", async () => {
		const { app, database, service } = setup();
		app.repositories.set(1, [repository(10)]);
		await service.reconcile(1);
		service.deactivate(1, "suspended");
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const readPage = app.readRepositories.bind(app);
		vi.spyOn(app, "readRepositories").mockImplementationOnce(async (id, page) => {
			const snapshot = await readPage(id, page);
			started.resolve();
			await release.promise;
			return snapshot;
		});
		const reactivation = service.reconcile(1);
		await started.promise;
		const dependencies = reviewDependencies(database, service);
		const review = requestReviewFromGithub(reviewEvent(10), dependencies);
		await new Promise<void>((resolve) => setImmediate(resolve));
		release.resolve();

		await Promise.all([reactivation, review]);

		expect(database.githubAccessRepository.findInstallation(1)?.status).toBe("active");
		expect(dependencies.queue.enqueueReview).toHaveBeenCalledOnce();
	});

	it.each([10, 11])(
		"does not retain a failed refresh when reviewing repository %i",
		async (id) => {
			const { app, database, service } = setup();
			app.repositories.set(1, [repository(10)]);
			await service.reconcile(1);
			app.repositories.set(1, [repository(10), repository(11)]);
			const read = vi
				.spyOn(app, "readRepositories")
				.mockRejectedValueOnce(new Error("offline"));
			await expect(service.reconcile(1)).rejects.toThrow("offline");
			read.mockRestore();
			const dependencies = reviewDependencies(database, service);

			await requestReviewFromGithub(reviewEvent(id), dependencies);

			expect(dependencies.queue.enqueueReview).toHaveBeenCalledOnce();
		},
	);

	it.each(["suspended", "deleted"] as const)(
		"does not restore a known %s installation from a delayed review event",
		async (status) => {
			const { app, database, service } = setup();
			app.repositories.set(1, [repository(10)]);
			await service.reconcile(1);
			service.deactivate(1, status);
			const dependencies = reviewDependencies(database, service);

			await requestReviewFromGithub(reviewEvent(10), dependencies);

			expect(database.githubAccessRepository.findInstallation(1)?.status).toBe(status);
			expect(dependencies.queue.enqueueReview).not.toHaveBeenCalled();
		},
	);

	it("reconciles signed lifecycle deliveries instead of trusting repository payloads", async () => {
		const { app, database, service } = setup();
		const probot = new Probot({ githubToken: "test-token", secret: "test-secret" });
		await probot.ready();
		registerGitHubInstallationHandlers(probot, {
			installationSync: service,
			deliveryRepository: database.webhookDeliveryRepository,
		});
		const deliver = async (
			name: "installation" | "installation_repositories" | "repository",
			action: string,
		) => {
			const payload = JSON.stringify({
				action,
				installation: { id: 1 },
				repositories: [repository(999)],
				repositories_added: [repository(999)],
			});
			await probot.webhooks.verifyAndReceive({
				id: `${name}.${action}`,
				name,
				payload,
				signature: await probot.webhooks.sign(payload),
			});
		};
		app.repositories.set(1, [repository(10)]);
		await deliver("installation", "created");
		expect(database.githubAccessRepository.findRepository(10, 1)?.status).toBe("active");
		expect(database.githubAccessRepository.findRepository(999, 1)).toBeNull();
		await deliver("installation", "suspend");
		expect(database.githubAccessRepository.findInstallation(1)?.status).toBe("suspended");
		app.repositories.set(1, [repository(11)]);
		await deliver("installation", "unsuspend");
		expect(database.githubAccessRepository.findInstallation(1)?.status).toBe("active");
		expect(database.githubAccessRepository.findRepository(10, 1)).toBeNull();
		app.repositories.set(1, [repository(11), repository(12)]);
		await deliver("installation_repositories", "added");
		expect(database.githubAccessRepository.findRepository(12, 1)?.status).toBe("active");
		app.installations.set(1, { ...installation(1), repository_selection: "all" });
		app.repositories.set(1, [repository(11), repository(12), repository(13)]);
		await deliver("repository", "created");
		expect(database.githubAccessRepository.findRepository(13, 1)?.status).toBe("active");
		app.repositories.set(1, [{ ...repository(13), name: "renamed" }]);
		await deliver("repository", "renamed");
		expect(
			database.githubAccessRepository.listInstallationSummaries()[0]?.repositories,
		).toContainEqual(expect.objectContaining({ fullName: "takeat/renamed" }));
		app.repositories.set(1, []);
		await deliver("installation_repositories", "removed");
		expect(database.githubAccessRepository.findRepository(13, 1)).toBeNull();
	});

	it.each(["selected", "all"] as const)(
		"loads all pages for %s installations with installation authentication",
		async (selection) => {
			const { app, database, service } = setup();
			app.installations.set(1, { ...installation(1), repository_selection: selection });
			app.repositories.set(
				1,
				Array.from({ length: 101 }, (_, index) => repository(index + 1)),
			);

			await service.reconcile(1);

			expect(
				database.githubAccessRepository.listInstallationSummaries()[0]?.repositories,
			).toHaveLength(101);
			expect(database.githubAccessRepository.findRepository(101, 1)).toEqual({
				status: "active",
				defaultBranch: "trunk",
			});
		},
	);

	it("keeps the previous snapshot and suspension when page two fails, then allows a successful retry", async () => {
		const { app, database, service } = setup();
		app.repositories.set(1, [repository(500)]);
		await service.reconcile(1);
		service.deactivate(1, "suspended");
		const before = database.githubAccessRepository.listInstallationSummaries();
		app.repositories.set(
			1,
			Array.from({ length: 101 }, (_, index) => repository(index + 1)),
		);
		const readPage = app.readRepositories.bind(app);
		vi.spyOn(app, "readRepositories").mockImplementation(async (id, page) => {
			if (page === 2) throw new Error("page two failed");
			return readPage(id, page);
		});

		await expect(service.reconcile(1)).rejects.toThrow("page two failed");
		expect(database.githubAccessRepository.listInstallationSummaries()).toEqual(before);
		vi.restoreAllMocks();
		await service.reconcile(1);
		expect(database.githubAccessRepository.findInstallation(1)?.status).toBe("active");
		expect(database.githubAccessRepository.findRepository(500, 1)).toBeNull();
	});

	it("removes only absent access in its installation, updates metadata, and retains review history", async () => {
		const { app, database, service } = setup();
		app.installations.set(2, installation(2));
		app.repositories.set(1, [repository(10), repository(11)]);
		app.repositories.set(2, [repository(20)]);
		await service.initialize();
		database.reviewRunRepository.createReviewRun({
			id: "historical-run",
			githubRepositoryId: 10,
			pullRequestNumber: 3,
			headSha: "a".repeat(40),
			trigger: "opened",
			status: "queued",
			policyJson: '{"enabled":true,"version":1}',
			policySource: "default",
			policyWarningCode: null,
			ignoreReason: null,
			model: database.selectedModel,
		});
		app.repositories.set(1, [{ ...repository(11), name: "renamed", default_branch: "main" }]);

		await service.reconcile(1);

		expect(database.githubAccessRepository.findRepository(10, 1)?.status).toBe("removed");
		expect(database.githubAccessRepository.findRepository(20, 2)?.status).toBe("active");
		expect(
			database.githubAccessRepository.listInstallationSummaries()[0]?.repositories,
		).toContainEqual(
			expect.objectContaining({
				githubRepositoryId: 11,
				fullName: "takeat/renamed",
				defaultBranch: "main",
			}),
		);
		expect(database.reviewRunRepository.findReviewRun(10, 3, "a".repeat(40))).toEqual({
			id: "historical-run",
			status: "queued",
		});
		app.repositories.set(1, []);
		await service.reconcile(1);
		expect(database.githubAccessRepository.findRepository(11, 1)).toBeNull();
		app.repositories.set(1, [repository(10), repository(11)]);
		await service.reconcile(1);
		expect(database.githubAccessRepository.findRepository(10, 1)?.status).toBe("active");
		expect(database.githubAccessRepository.findRepository(11, 1)?.status).toBe("active");

		service.deactivate(1, "deleted");
		expect(database.githubAccessRepository.findRepository(10, 1)?.status).toBe("removed");
		expect(database.githubAccessRepository.findRepository(11, 1)).toBeNull();
		expect(database.githubAccessRepository.findRepository(20, 2)?.status).toBe("active");
		expect(database.reviewRunRepository.findReviewRun(10, 3, "a".repeat(40))).toEqual({
			id: "historical-run",
			status: "queued",
		});
	});

	it("rejects invalid or inconsistent inventories without writing access", async () => {
		const { app, database, service } = setup();
		app.repositories.set(1, [{ ...repository(10), default_branch: "" }]);
		await expect(service.reconcile(1)).rejects.toMatchObject({ name: "ZodError" });
		expect(database.githubAccessRepository.findInstallation(1)).toBeNull();
		app.repositories.set(1, [repository(10), repository(10)]);
		await expect(service.reconcile(1)).rejects.toThrow("duplicate repositories");
		expect(database.githubAccessRepository.findInstallation(1)).toBeNull();
	});

	it.each(["suspended", "deleted"] as const)(
		"does not reactivate access after %s arrives during pagination",
		async (status) => {
			const { app, database, service } = setup();
			app.repositories.set(1, [repository(10)]);
			await service.reconcile(1);
			const started = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const readPage = app.readRepositories.bind(app);
			vi.spyOn(app, "readRepositories").mockImplementationOnce(async (id, page) => {
				const snapshot = await readPage(id, page);
				started.resolve();
				await release.promise;
				return snapshot;
			});
			const pending = service.reconcile(1);
			await started.promise;
			service.deactivate(1, status);
			release.resolve();
			await pending;

			expect(database.githubAccessRepository.findInstallation(1)?.status).toBe(status);
		},
	);

	it("discards an older snapshot when a newer repository event arrives", async () => {
		const { app, database, service } = setup();
		app.repositories.set(1, [repository(10)]);
		await service.reconcile(1);
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const readPage = app.readRepositories.bind(app);
		vi.spyOn(app, "readRepositories").mockImplementationOnce(async (id, page) => {
			const snapshot = await readPage(id, page);
			started.resolve();
			await release.promise;
			return snapshot;
		});
		const older = service.reconcile(1);
		await started.promise;
		app.repositories.set(1, [repository(11)]);
		const newer = service.reconcile(1);
		release.resolve();
		await Promise.all([older, newer]);

		expect(database.githubAccessRepository.findRepository(10, 1)).toBeNull();
		expect(database.githubAccessRepository.findRepository(11, 1)?.status).toBe("active");
	});

	it("discovers beyond one installation page, enforces allowlist and isolates startup failures", async () => {
		const { app, database, service } = setup();
		app.repositories.set(1, [repository(10)]);
		await service.reconcile(1);
		app.installations.delete(1);
		for (let id = 2; id <= 102; id++) {
			app.installations.set(id, { ...installation(id), account: { login: "outside" } });
		}
		app.installations.set(101, installation(101));
		app.installations.set(102, installation(102));
		app.repositories.set(102, [repository(1020)]);
		const readPage = app.readRepositories.bind(app);
		vi.spyOn(app, "readRepositories").mockImplementation(async (id, page) => {
			if (id === 101) throw new Error("installation unavailable");
			return readPage(id, page);
		});

		await service.initialize();

		expect(database.githubAccessRepository.findInstallation(1)?.status).toBe("deleted");
		expect(database.githubAccessRepository.findRepository(10, 1)).toBeNull();
		expect(database.githubAccessRepository.findInstallation(2)).toBeNull();
		expect(database.githubAccessRepository.findInstallation(101)).toBeNull();
		expect(database.githubAccessRepository.findRepository(1020, 102)?.status).toBe("active");
		expect(app.log.error).toHaveBeenCalledWith(
			expect.objectContaining({ installationId: 101 }),
			"github_installation.reconciliation_failed",
		);
	});
});

function reviewDependencies(
	database: TestDatabase,
	installationSync: GitHubInstallationSyncService,
): GitHubReviewWorkflowDependencies {
	return {
		accessRepository: database.githubAccessRepository,
		installationSync,
		allowedAccounts: new Set(["takeat"]),
		deliveryRepository: database.webhookDeliveryRepository,
		modelRepository: database.modelCatalogRepository,
		reportRepository: database.reviewReportRepository,
		runRepository: database.reviewRunRepository,
		policyService: {
			resolve: vi.fn().mockResolvedValue({
				policy: { version: 1, enabled: true },
				source: "default",
				warningCode: null,
			}),
		},
		queue: {
			enqueueReview: vi.fn().mockResolvedValue(undefined),
			enqueueReport: vi.fn().mockResolvedValue(undefined),
		},
	};
}

function reviewEvent(repositoryId: number) {
	return {
		delivery: {
			deliveryId: `pull-request-${repositoryId}`,
			eventName: "pull_request.opened",
			installationId: 1,
		},
		isDraft: false,
		pullRequestState: "open" as const,
		request: {
			deliveryId: `pull-request-${repositoryId}`,
			installationId: 1,
			accountLogin: "takeat",
			repositoryId,
			repositoryOwner: "takeat",
			repositoryName: `repository-${repositoryId}`,
			repositoryFullName: `takeat/repository-${repositoryId}`,
			repositoryDefaultBranch: "trunk",
			pullRequestNumber: 3,
			headSha: "a".repeat(40),
			trigger: "opened" as const,
		},
	};
}
