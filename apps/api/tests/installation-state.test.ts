import { reviewReports, reviewRuns, webhookDeliveries } from "@codekeat/database";
import { describe, expect, it, vi } from "vitest";

import {
	type GitHubReviewWorkflowDependencies,
	requestReviewFromGithub,
} from "#core/workflows/request-review-from-github";
import type { RequestReview } from "#features/review";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

const PULL_REQUEST: RequestReview = {
	deliveryId: "delivery-1",
	installationId: 1,
	accountLogin: "takeat",
	repositoryId: 2,
	repositoryOwner: "takeat",
	repositoryName: "codekeat",
	repositoryFullName: "takeat/codekeat",
	repositoryDefaultBranch: "main",
	pullRequestNumber: 3,
	headSha: "a".repeat(40),
	trigger: "opened",
};
const EVENT = {
	delivery: { deliveryId: "delivery-1", eventName: "pull_request.opened", installationId: 1 },
	isDraft: false,
	pullRequestState: "open",
	request: PULL_REQUEST,
} as const;

describe("installation state", () => {
	it("does not restore removed access when a delayed pull request arrives", async () => {
		const { database, dependencies } = createWorkflow();
		activateRepository(database);
		database.githubAccessRepository.setRepositoryStatus(2, "removed");

		await requestReviewFromGithub(EVENT, dependencies);

		expectIgnored(database, dependencies, "repository_not_active");
		expect(database.githubAccessRepository.findRepository(2, 1)?.status).toBe("removed");
		database.close();
	});

	it("does not register an unknown repository from a pull request payload", async () => {
		const { database, dependencies } = createWorkflow();

		await requestReviewFromGithub(EVENT, dependencies);

		expectIgnored(database, dependencies, "repository_not_active");
		expect(database.githubAccessRepository.findRepository(2, 1)).toBeNull();
		database.close();
	});

	it("does not borrow access from another installation or move its repository", async () => {
		const { database, dependencies } = createWorkflow();
		database.githubAccessRepository.upsertInstallation({
			githubInstallationId: 4,
			accountLogin: "takeat",
			status: "active",
		});
		activateRepository(database, 4);

		await requestReviewFromGithub(EVENT, dependencies);

		expectIgnored(database, dependencies, "repository_not_active");
		expect(database.githubAccessRepository.findRepository(2, 1)).toBeNull();
		expect(database.githubAccessRepository.findRepository(2, 4)?.status).toBe("active");
		database.close();
	});

	it("does not request a review from a suspended installation with an active repository", async () => {
		const { database, dependencies } = createWorkflow();
		activateRepository(database);
		database.githubAccessRepository.setInstallationStatus(1, "suspended");

		await requestReviewFromGithub(EVENT, dependencies);

		expect(database.connection.db.select().from(webhookDeliveries).all()).toMatchObject([
			{ status: "ignored", reasonCode: "installation_not_active" },
		]);
		expect(database.connection.db.select().from(reviewRuns).all()).toEqual([]);
		database.close();
	});

	it("ignores a closed pull request even when repository access is active", async () => {
		const { database, dependencies } = createWorkflow();
		activateRepository(database);

		await requestReviewFromGithub({ ...EVENT, pullRequestState: "closed" }, dependencies);
		await requestReviewFromGithub({ ...EVENT, pullRequestState: "closed" }, dependencies);

		expect(database.connection.db.select().from(webhookDeliveries).all()).toMatchObject([
			{ status: "ignored", reasonCode: "closed_pull_request", attempts: 1 },
		]);
		expect(database.connection.db.select().from(reviewRuns).all()).toEqual([]);
		database.close();
	});

	it.each(["installation_not_active", "repository_not_active"])(
		"re-evaluates a legacy %s delivery after verified access is restored",
		async (reasonCode) => {
			const { database, dependencies } = createWorkflow();
			if (reasonCode === "installation_not_active") {
				database.githubAccessRepository.setInstallationStatus(1, "suspended");
			}
			await requestReviewFromGithub(EVENT, dependencies);
			expectIgnored(database, dependencies, reasonCode);
			database.githubAccessRepository.setInstallationStatus(1, "active");
			activateRepository(database);

			await requestReviewFromGithub(EVENT, dependencies);

			expect(database.connection.db.select().from(webhookDeliveries).all()).toMatchObject([
				{ status: "handled", attempts: 2 },
			]);
			expect(dependencies.queue.enqueueReview).toHaveBeenCalledOnce();
			database.close();
		},
	);

	it("queues a review only for an active repository in the active installation", async () => {
		const { database, dependencies } = createWorkflow();
		activateRepository(database);

		await requestReviewFromGithub(EVENT, dependencies);

		const runs = database.connection.db.select().from(reviewRuns).all();
		expect(runs).toMatchObject([{ status: "queued", githubRepositoryId: 2 }]);
		expect(dependencies.queue.enqueueReview).toHaveBeenCalledWith(runs[0]?.id);
		database.close();
	});
});

function createWorkflow(): {
	readonly database: TestDatabase;
	readonly dependencies: GitHubReviewWorkflowDependencies;
} {
	const database = createTestDatabase();
	database.githubAccessRepository.upsertInstallation({
		githubInstallationId: 1,
		accountLogin: "takeat",
		status: "active",
	});
	const allowedAccounts = new Set<string>();
	allowedAccounts.add("takeat");
	return {
		database,
		dependencies: {
			accessRepository: database.githubAccessRepository,
			installationSync: { ensureRepositoryAccess: vi.fn().mockResolvedValue(undefined) },
			allowedAccounts,
			deliveryRepository: database.webhookDeliveryRepository,
			modelRepository: database.modelCatalogRepository,
			policyService: {
				resolve: vi
					.fn<GitHubReviewWorkflowDependencies["policyService"]["resolve"]>()
					.mockResolvedValue({
						policy: { version: 1, enabled: true },
						source: "default",
						warningCode: null,
					}),
			},
			reportRepository: database.reviewReportRepository,
			runRepository: database.reviewRunRepository,
			queue: {
				enqueueReview: vi.fn().mockResolvedValue(undefined),
				enqueueReport: vi.fn().mockResolvedValue(undefined),
			},
		},
	};
}

function activateRepository(database: TestDatabase, installationId = 1): void {
	database.githubAccessRepository.upsertRepository({
		githubRepositoryId: 2,
		installationId,
		ownerLogin: "takeat",
		name: "codekeat",
		defaultBranch: "main",
		status: "active",
	});
}

function expectIgnored(
	database: TestDatabase,
	dependencies: GitHubReviewWorkflowDependencies,
	reasonCode: string,
): void {
	expect(database.connection.db.select().from(reviewRuns).all()).toEqual([]);
	expect(database.connection.db.select().from(reviewReports).all()).toEqual([]);
	expect(database.connection.db.select().from(webhookDeliveries).all()).toMatchObject([
		{ status: "ignored", reasonCode },
	]);
	expect(dependencies.policyService.resolve).not.toHaveBeenCalled();
	expect(dependencies.queue.enqueueReview).not.toHaveBeenCalled();
	expect(dependencies.queue.enqueueReport).not.toHaveBeenCalled();
}
