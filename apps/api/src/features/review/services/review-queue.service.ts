import PQueue from "p-queue";
import type { Logger } from "pino";

import type {
	ReviewReportPublisherTask,
	ReviewRunProcessorTask,
	ReviewWorkQueue,
} from "../types/review-run.types.js";

export class ReviewQueueService implements ReviewWorkQueue {
	private readonly reviewQueue: PQueue;
	private readonly reportQueue = new PQueue({ concurrency: 1 });

	constructor(
		private readonly processor: ReviewRunProcessorTask,
		private readonly publisher: ReviewReportPublisherTask,
		private readonly logger: Logger,
		reviewConcurrency: number,
	) {
		this.reviewQueue = new PQueue({ concurrency: reviewConcurrency });
	}

	async enqueueReview(reviewRunId: string): Promise<void> {
		void this.reviewQueue
			.add(() => this.processor.process(reviewRunId))
			.catch(() => {
				this.logger.error({ reviewRunId }, "review_run.processing_failed");
			});

		this.logger.info({ reviewRunId }, "review_run.queued");
	}

	async enqueueReport(reviewReportId: string): Promise<void> {
		void this.reportQueue
			.add(() => this.publisher.publish(reviewReportId))
			.catch(() => {
				this.logger.error({ reviewReportId }, "review_report.processing_failed");
			});
	}
}
