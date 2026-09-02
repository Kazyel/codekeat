import { performance } from "node:perf_hooks";

import type { Logger } from "pino";

import type { ReviewReportRepository } from "../repositories/review-report.repository.js";
import type { ReviewReportPublisherClient } from "../types/review-publication.types.js";

export class ReviewReportPublisherService {
	constructor(
		private readonly repository: ReviewReportRepository,
		private readonly client: ReviewReportPublisherClient,
		private readonly logger: Logger,
	) {}

	async publish(reviewReportId: string): Promise<void> {
		const report = this.repository.claimReviewReport(reviewReportId);
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
			this.repository.completeReviewReport(reviewReportId, comment);
			this.logger.info(
				{ durationMs: elapsedMilliseconds(startedAt), reviewReportId },
				"review_report.published",
			);
		} catch {
			this.repository.failReviewReport(reviewReportId, "github_comment_unavailable");
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
