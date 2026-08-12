import { findings, reviewRuns } from "@codekeat/database";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { ReviewModelResponseError } from "../src/modules/ai/review-model.js";
import { ReviewRunProcessor } from "../src/modules/review/process-review-run.js";
import type {
  ReviewInput,
  ReviewInputSource,
  ReviewModel,
} from "../src/modules/review/review-input.js";
import type { ReviewFinding, ReviewWorkQueue } from "../src/modules/review/review-run.js";
import { createTestDatabase } from "./test-database.js";

const logger = pino({ enabled: false });
const reviewRunId = "review-run-1";
const headSha = "a".repeat(40);

describe("ReviewRunProcessor", () => {
  it("claims a queued run, processes chunks sequentially, and persists findings", async () => {
    const database = createReviewRun();
    const model = new RecordedModel([validFinding, validFinding]);
    const processor = new ReviewRunProcessor(
      database.store,
      new ReadyInputSource(twoChunkInput),
      model,
      new RecordedQueue(),
      logger,
    );

    await processor.process(reviewRunId);

    expect(model.chunkIndexes).toEqual([1, 2]);
    expect(database.connection.db.select().from(findings).all()).toHaveLength(1);
    expect(readRun(database).status).toBe("completed");
    expect(readRun(database).modelName).toBe("test-model");
    expect(readRun(database).startedAt).not.toBeNull();
    expect(readRun(database).completedAt).not.toBeNull();
    database.close();
  });

  it("ignores an outdated head SHA without calling the model", async () => {
    const database = createReviewRun();
    const model = new RecordedModel([]);
    const processor = new ReviewRunProcessor(
      database.store,
      new IgnoredInputSource(),
      model,
      new RecordedQueue(),
      logger,
    );

    await processor.process(reviewRunId);

    expect(model.chunkIndexes).toEqual([]);
    expect(readRun(database)).toMatchObject({
      status: "ignored",
      ignoreReason: "superseded_head_sha",
    });
    database.close();
  });

  it("fails without partial persistence for an invalid finding location", async () => {
    const database = createReviewRun();
    const invalidFinding = { ...validFinding, line: 99 };
    const processor = new ReviewRunProcessor(
      database.store,
      new ReadyInputSource(oneChunkInput),
      new RecordedModel([invalidFinding]),
      new RecordedQueue(),
      logger,
    );

    await processor.process(reviewRunId);

    expect(readRun(database)).toMatchObject({
      status: "failed",
      errorCode: "finding_location_invalid",
    });
    expect(database.connection.db.select().from(findings).all()).toEqual([]);
    database.close();
  });

  it("fails with a sanitized Gemini response code", async () => {
    const database = createReviewRun();
    const processor = new ReviewRunProcessor(
      database.store,
      new ReadyInputSource(oneChunkInput),
      new FailingModel(),
      new RecordedQueue(),
      logger,
    );

    await processor.process(reviewRunId);

    expect(readRun(database)).toMatchObject({
      status: "failed",
      errorCode: "gemini_invalid_response",
    });
    expect(database.connection.db.select().from(findings).all()).toEqual([]);
    database.close();
  });

  it("does not process an already claimed run twice", async () => {
    const database = createReviewRun();
    const model = new RecordedModel([validFinding]);
    const processor = new ReviewRunProcessor(
      database.store,
      new ReadyInputSource(oneChunkInput),
      model,
      new RecordedQueue(),
      logger,
    );

    await processor.process(reviewRunId);
    await processor.process(reviewRunId);

    expect(model.chunkIndexes).toEqual([1]);
    database.close();
  });
});

class ReadyInputSource implements ReviewInputSource {
  constructor(private readonly input: ReviewInput) {}

  async load() {
    return { kind: "ready" as const, input: this.input };
  }
}

class IgnoredInputSource implements ReviewInputSource {
  async load() {
    return { kind: "ignored" as const, ignoreReason: "superseded_head_sha" as const };
  }
}

class RecordedModel implements ReviewModel {
  readonly name = "test-model";
  readonly chunkIndexes: number[] = [];

  constructor(private readonly responses: readonly ReviewFinding[]) {}

  async review(
    _: ReviewInput,
    chunk: ReviewInput["chunks"][number],
  ): Promise<readonly ReviewFinding[]> {
    this.chunkIndexes.push(chunk.index);
    return this.responses;
  }
}

class FailingModel implements ReviewModel {
  readonly name = "test-model";

  async review(): Promise<readonly ReviewFinding[]> {
    throw new ReviewModelResponseError();
  }
}

class RecordedQueue implements Pick<ReviewWorkQueue, "enqueueReport"> {
  readonly reviewReportIds: string[] = [];

  async enqueueReport(reviewReportId: string): Promise<void> {
    this.reviewReportIds.push(reviewReportId);
  }
}

function createReviewRun() {
  const database = createTestDatabase();
  database.store.upsertInstallation({
    githubInstallationId: 10,
    accountLogin: "takeat",
    status: "active",
  });
  database.store.upsertRepository({
    githubRepositoryId: 20,
    installationId: 10,
    ownerLogin: "takeat",
    name: "codekeat",
    defaultBranch: "main",
    status: "active",
  });
  database.store.createReviewRun({
    id: reviewRunId,
    githubRepositoryId: 20,
    pullRequestNumber: 30,
    headSha,
    trigger: "opened",
    status: "queued",
    policyJson: '{"enabled":true,"version":1}',
    policySource: "default",
    policyWarningCode: null,
    ignoreReason: null,
  });
  return database;
}

function readRun(database: ReturnType<typeof createReviewRun>) {
  const run = database.connection.db.select().from(reviewRuns).get();
  if (run === undefined) {
    throw new Error("Review run is missing.");
  }
  return run;
}

const validFinding: ReviewFinding = {
  severity: "high",
  path: "src/example.ts",
  line: 2,
  title: "A concrete problem",
  rationale: "The added line needs a concrete correction.",
};

const oneChunkInput: ReviewInput = {
  body: null,
  chunks: [
    { changedLines: new Map([["src/example.ts", new Set([2])]]), diff: "diff", index: 1, total: 1 },
  ],
  headSha,
  pullRequestNumber: 30,
  repositoryFullName: "takeat/codekeat",
  reviewRunId,
  title: "Review input",
};

const twoChunkInput: ReviewInput = {
  ...oneChunkInput,
  chunks: [
    { changedLines: new Map([["src/example.ts", new Set([2])]]), diff: "one", index: 1, total: 2 },
    { changedLines: new Map([["src/example.ts", new Set([2])]]), diff: "two", index: 2, total: 2 },
  ],
};
