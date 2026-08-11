import { describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database.js";

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
});
