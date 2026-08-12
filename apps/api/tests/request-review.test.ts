import { reviewReports, reviewRuns } from "@codekeat/database";
import { describe, expect, it } from "vitest";

import type { ResolvedRepositoryPolicy } from "../src/modules/repository-policy/repository-policy.js";
import {
  type RepositoryPolicyResolver,
  requestReview,
} from "../src/modules/review/request-review.js";
import type { RequestReview, ReviewWorkQueue } from "../src/modules/review/review-run.js";
import { createTestDatabase } from "./test-database.js";

const reviewRequest: RequestReview = {
  deliveryId: "delivery-1",
  installationId: 10,
  accountLogin: "takeat",
  repositoryId: 20,
  repositoryOwner: "takeat",
  repositoryName: "codekeat",
  repositoryFullName: "takeat/codekeat",
  repositoryDefaultBranch: "main",
  pullRequestNumber: 30,
  headSha: "a".repeat(40),
  trigger: "opened",
};

describe("requestReview", () => {
  it("persists and queues an enabled review", async () => {
    const database = createTestDatabase();
    prepareActiveRepository(database);
    const queue = new RecordedQueue();

    const result = await requestReview(reviewRequest, {
      store: database.store,
      queue,
      policyResolver: new FixedPolicyResolver(enabledPolicy),
    });

    const runs = database.connection.db.select().from(reviewRuns).all();
    expect(result.kind).toBe("queued");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("queued");
    expect(queue.reviewRunIds).toEqual([runs[0]?.id]);
    database.close();
  });

  it("records an ignored run when the repository policy is disabled", async () => {
    const database = createTestDatabase();
    prepareActiveRepository(database);
    const queue = new RecordedQueue();

    const result = await requestReview(reviewRequest, {
      store: database.store,
      queue,
      policyResolver: new FixedPolicyResolver(disabledPolicy),
    });

    const runs = database.connection.db.select().from(reviewRuns).all();
    expect(result.kind).toBe("ignored");
    expect(runs[0]?.status).toBe("ignored");
    expect(runs[0]?.ignoreReason).toBe("repository_policy_disabled");
    expect(queue.reviewRunIds).toEqual([]);
    database.close();
  });

  it("deduplicates different deliveries for the same pull request SHA", async () => {
    const database = createTestDatabase();
    prepareActiveRepository(database);
    const queue = new RecordedQueue();
    const dependencies = {
      store: database.store,
      queue,
      policyResolver: new FixedPolicyResolver(enabledPolicy),
    };

    await requestReview(reviewRequest, dependencies);
    const duplicate = await requestReview(
      { ...reviewRequest, deliveryId: "delivery-2", trigger: "synchronize" },
      dependencies,
    );

    expect(duplicate.kind).toBe("duplicate");
    expect(database.connection.db.select().from(reviewRuns).all()).toHaveLength(1);
    expect(queue.reviewRunIds).toHaveLength(1);
    database.close();
  });

  it("creates another run for a new pull request SHA", async () => {
    const database = createTestDatabase();
    prepareActiveRepository(database);
    const queue = new RecordedQueue();
    const dependencies = {
      store: database.store,
      queue,
      policyResolver: new FixedPolicyResolver(enabledPolicy),
    };

    await requestReview(reviewRequest, dependencies);
    await requestReview(
      { ...reviewRequest, deliveryId: "delivery-3", headSha: "b".repeat(40) },
      dependencies,
    );

    expect(database.connection.db.select().from(reviewRuns).all()).toHaveLength(2);
    expect(queue.reviewRunIds).toHaveLength(2);
    database.close();
  });

  it("persists the invalid policy warning with the default policy", async () => {
    const database = createTestDatabase();
    prepareActiveRepository(database);

    await requestReview(reviewRequest, {
      store: database.store,
      queue: new RecordedQueue(),
      policyResolver: new FixedPolicyResolver(invalidPolicyFallback),
    });

    const runs = database.connection.db.select().from(reviewRuns).all();
    expect(runs[0]?.policySource).toBe("default");
    expect(runs[0]?.policyWarningCode).toBe("invalid_repository_policy");
    database.close();
  });

  it("reopens a failed run when the repository remains eligible", async () => {
    const database = createTestDatabase();
    prepareActiveRepository(database);
    const queue = new RecordedQueue();
    database.store.createReviewRun({
      id: "failed-run",
      githubRepositoryId: reviewRequest.repositoryId,
      pullRequestNumber: reviewRequest.pullRequestNumber,
      headSha: reviewRequest.headSha,
      trigger: "opened",
      status: "failed",
      policyJson: '{"enabled":true,"version":1}',
      policySource: "default",
      policyWarningCode: null,
      ignoreReason: null,
    });

    const result = await requestReview(
      { ...reviewRequest, trigger: "reopened" },
      { store: database.store, queue, policyResolver: new FixedPolicyResolver(enabledPolicy) },
    );

    expect(result.kind).toBe("queued");
    expect(queue.reviewRunIds).toEqual(["failed-run"]);
    expect(database.connection.db.select().from(reviewRuns).get()?.status).toBe("queued");
    database.close();
  });

  it("reopens a completed run by scheduling its missing report without Gemini work", async () => {
    const database = createTestDatabase();
    prepareActiveRepository(database);
    const queue = new RecordedQueue();
    database.store.createReviewRun({
      id: "completed-run",
      githubRepositoryId: reviewRequest.repositoryId,
      pullRequestNumber: reviewRequest.pullRequestNumber,
      headSha: reviewRequest.headSha,
      trigger: "opened",
      status: "queued",
      policyJson: '{"enabled":true,"version":1}',
      policySource: "default",
      policyWarningCode: null,
      ignoreReason: null,
    });
    database.store.completeReviewRun("completed-run", "test-model", [], "report-1");

    const result = await requestReview(
      { ...reviewRequest, trigger: "reopened" },
      { store: database.store, queue, policyResolver: new FixedPolicyResolver(enabledPolicy) },
    );

    expect(result.kind).toBe("report_queued");
    expect(queue.reviewRunIds).toEqual([]);
    expect(queue.reviewReportIds).toEqual(["report-1"]);
    expect(database.connection.db.select().from(reviewReports).get()?.status).toBe("pending");
    database.close();
  });
});

class RecordedQueue implements ReviewWorkQueue {
  readonly reviewRunIds: string[] = [];
  readonly reviewReportIds: string[] = [];

  async enqueueReview(reviewRunId: string): Promise<void> {
    this.reviewRunIds.push(reviewRunId);
  }

  async enqueueReport(reviewReportId: string): Promise<void> {
    this.reviewReportIds.push(reviewReportId);
  }
}

class FixedPolicyResolver implements RepositoryPolicyResolver {
  constructor(private readonly policy: ResolvedRepositoryPolicy) {}

  async resolve(): Promise<ResolvedRepositoryPolicy> {
    return this.policy;
  }
}

function prepareActiveRepository(database: ReturnType<typeof createTestDatabase>): void {
  database.store.upsertInstallation({
    githubInstallationId: reviewRequest.installationId,
    accountLogin: reviewRequest.accountLogin,
    status: "active",
  });
  database.store.upsertRepository({
    githubRepositoryId: reviewRequest.repositoryId,
    installationId: reviewRequest.installationId,
    ownerLogin: reviewRequest.repositoryOwner,
    name: reviewRequest.repositoryName,
    defaultBranch: reviewRequest.repositoryDefaultBranch,
    status: "active",
  });
}

const enabledPolicy: ResolvedRepositoryPolicy = {
  policy: { version: 1, enabled: true },
  source: "repository",
  warningCode: null,
};

const disabledPolicy: ResolvedRepositoryPolicy = {
  policy: { version: 1, enabled: false },
  source: "repository",
  warningCode: null,
};

const invalidPolicyFallback: ResolvedRepositoryPolicy = {
  policy: { version: 1, enabled: true },
  source: "default",
  warningCode: "invalid_repository_policy",
};
