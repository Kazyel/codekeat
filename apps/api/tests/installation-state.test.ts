import { describe, expect, it } from "vitest";

import { preparePullRequestRepository } from "../src/modules/github/register-webhooks.js";
import type { RequestReview } from "../src/modules/review/review-run.js";
import { createTestDatabase } from "./test-database.js";

const pullRequest: RequestReview = {
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
    database.store.upsertInstallation({
      githubInstallationId: 1,
      accountLogin: "takeat",
      status: "active",
    });
    database.store.upsertRepository({
      githubRepositoryId: 2,
      installationId: 1,
      ownerLogin: "takeat",
      name: "codekeat",
      defaultBranch: "main",
      status: "active",
    });

    database.store.setInstallationStatus(1, "suspended");
    database.store.setRepositoryStatus(2, "removed");

    expect(database.store.findInstallation(1)?.status).toBe("suspended");
    expect(database.store.findRepository(2, 1)?.status).toBe("removed");
    database.close();
  });

  it("activates a repository when its installation event was missed", () => {
    const database = createTestDatabase();
    database.store.upsertInstallation({
      githubInstallationId: 1,
      accountLogin: "takeat",
      status: "active",
    });

    const allowedAccounts = new Set<string>();
    allowedAccounts.add("takeat");

    const ignoreReason = preparePullRequestRepository(pullRequest, false, {
      store: database.store,
      allowedAccounts,
    });

    expect(ignoreReason).toBeNull();
    expect(database.store.findRepository(2, 1)).toEqual({
      defaultBranch: "main",
      status: "active",
    });
    database.close();
  });
});
