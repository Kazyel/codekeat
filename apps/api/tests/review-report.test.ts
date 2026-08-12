import { reviewReports } from "@codekeat/database";
import pino from "pino";
import { describe, expect, it } from "vitest";

import type { ReviewReportPublisherClient } from "../src/modules/github/publish-review-report.js";
import { ReviewReportPublisher } from "../src/modules/review/publish-review-report.js";
import { formatReviewReport } from "../src/modules/review/review-report.js";
import { createTestDatabase } from "./test-database.js";

const reviewRunId = "review-run-1";

describe("ReviewReportPublisher", () => {
  it("publishes a positive report when a completed run has no findings", async () => {
    const database = createCompletedReview([]);
    const client = new RecordedPublisher();
    const report = database.connection.db.select().from(reviewReports).get();
    if (report === undefined) {
      throw new Error("Review report is missing.");
    }

    await new ReviewReportPublisher(database.store, client, pino({ enabled: false })).publish(
      report.id,
    );

    expect(client.reports).toHaveLength(1);
    expect(formatReviewReport(client.reports[0] ?? fail())).toContain(
      "Não encontramos problemas concretos",
    );
    expect(database.connection.db.select().from(reviewReports).get()?.status).toBe("published");
    database.close();
  });

  it("updates an existing comment and records publication failures", async () => {
    const database = createCompletedReview([finding]);
    const report = database.connection.db.select().from(reviewReports).get();
    if (report === undefined) {
      throw new Error("Review report is missing.");
    }
    database.store.completeReviewReport(report.id, {
      githubCommentId: 55,
      githubCommentUrl: "https://github.com/takeat/codekeat/pull/30#issuecomment-55",
    });
    database.store.failReviewReport(report.id, "github_comment_unavailable");
    database.store.prepareReviewReport(reviewRunId, "report-2");
    const client = new FailingPublisher();

    await new ReviewReportPublisher(database.store, client, pino({ enabled: false })).publish(
      report.id,
    );

    expect(database.connection.db.select().from(reviewReports).get()).toMatchObject({
      status: "failed",
      errorCode: "github_comment_unavailable",
    });
    database.close();
  });
});

describe("formatReviewReport", () => {
  it("groups findings and escapes model-controlled Markdown and mentions", () => {
    const report = createReport([finding]);
    const body = formatReviewReport(report);

    expect(body).toContain("### High (1)");
    expect(body).toContain("src/example.ts:2");
    expect(body).toContain("@​team");
    expect(body).toContain("\\*unsafe\\*");
  });
});

class RecordedPublisher implements ReviewReportPublisherClient {
  readonly reports: Parameters<ReviewReportPublisherClient["publish"]>[0][] = [];

  async publish(
    report: Parameters<ReviewReportPublisherClient["publish"]>[0],
  ): Promise<{ readonly githubCommentId: number; readonly githubCommentUrl: string }> {
    this.reports.push(report);
    return {
      githubCommentId: report.githubCommentId ?? 99,
      githubCommentUrl: "https://github.com/takeat/codekeat/pull/30#issuecomment-99",
    };
  }
}

class FailingPublisher implements ReviewReportPublisherClient {
  async publish(): Promise<never> {
    throw new Error("GitHub is unavailable.");
  }
}

function createCompletedReview(reviewFindings: readonly (typeof finding)[]) {
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
    headSha: "a".repeat(40),
    trigger: "opened",
    status: "queued",
    policyJson: '{"enabled":true,"version":1}',
    policySource: "default",
    policyWarningCode: null,
    ignoreReason: null,
  });
  database.store.completeReviewRun(
    reviewRunId,
    "test-model",
    reviewFindings.map((currentFinding, index) => ({ ...currentFinding, id: `finding-${index}` })),
    "report-1",
  );
  return database;
}

function createReport(reviewFindings: readonly (typeof finding)[]) {
  const database = createCompletedReview(reviewFindings);
  const report = database.store.claimReviewReport("report-1");
  database.close();
  if (report === null) {
    throw new Error("Publishable review report is missing.");
  }
  return report;
}

function fail(): never {
  throw new Error("Expected report is missing.");
}

const finding = {
  severity: "high" as const,
  path: "src/example.ts",
  line: 2,
  title: "*unsafe* @team",
  rationale: "A concrete rationale.",
};
