import { describe, expect, it } from "vitest";

import { preparePullRequestRepository } from "#core/workflows/request-review-from-github";
import type { RequestReview } from "#features/review";
import { createTestDatabase } from "./test-database.js";

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

describe("installation state", () => {
	it("updates repository access when an installation changes", () => {
		const database = createTestDatabase();
		database.githubAccessRepository.upsertInstallation({
			githubInstallationId: 1,
			accountLogin: "takeat",
			status: "active",
		});
		database.githubAccessRepository.upsertRepository({
			githubRepositoryId: 2,
			installationId: 1,
			ownerLogin: "takeat",
			name: "codekeat",
			defaultBranch: "main",
			status: "active",
		});

		database.githubAccessRepository.setInstallationStatus(1, "suspended");
		database.githubAccessRepository.setRepositoryStatus(2, "removed");

		expect(database.githubAccessRepository.findInstallation(1)?.status).toBe("suspended");
		expect(database.githubAccessRepository.findRepository(2, 1)?.status).toBe("removed");
		database.close();
	});

	it("activates a repository when its installation event was missed", () => {
		const database = createTestDatabase();
		database.githubAccessRepository.upsertInstallation({
			githubInstallationId: 1,
			accountLogin: "takeat",
			status: "active",
		});

		const allowedAccounts = new Set<string>();
		allowedAccounts.add("takeat");

		const ignoreReason = preparePullRequestRepository(
			{ request: PULL_REQUEST, isDraft: false },
			{ accessRepository: database.githubAccessRepository, allowedAccounts },
		);

		expect(ignoreReason).toBeNull();
		expect(database.githubAccessRepository.findRepository(2, 1)).toEqual({
			defaultBranch: "main",
			status: "active",
		});
		database.close();
	});
});
