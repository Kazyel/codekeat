import { performance } from "node:perf_hooks";

import type { WebhookStore } from "@codekeat/database";
import type { Logger } from "pino";

import type { ReviewReportPublisherClient } from "../github/publish-review-report.js";

export class ReviewReportPublisher {
  constructor(
    private readonly store: WebhookStore,
    private readonly client: ReviewReportPublisherClient,
    private readonly logger: Logger,
  ) {}

  async publish(reviewReportId: string): Promise<void> {
    const report = this.store.claimReviewReport(reviewReportId);
    if (report === null) {
      return;
    }

    const startedAt = performance.now();
    this.logger.info(
      { findingCount: report.findings.length, reviewReportId },
      "review_report.publish_started",
    );

    try {
      const comment = await this.client.publish(report);
      this.store.completeReviewReport(reviewReportId, comment);
      this.logger.info(
        { durationMs: elapsedMilliseconds(startedAt), reviewReportId },
        "review_report.published",
      );
    } catch {
      this.store.failReviewReport(reviewReportId, "github_comment_unavailable");
      this.logger.warn(
        {
          durationMs: elapsedMilliseconds(startedAt),
          errorCode: "github_comment_unavailable",
          reviewReportId,
        },
        "review_report.failed",
      );
    }
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
