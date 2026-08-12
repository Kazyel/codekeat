import PQueue from "p-queue";
import type { Logger } from "pino";

import type {
  ReviewReportPublisherTask,
  ReviewRunProcessorTask,
  ReviewWorkQueue,
} from "./review-run.js";

export class LocalReviewWorkQueue implements ReviewWorkQueue {
  private readonly queue = new PQueue({ concurrency: 1 });

  constructor(
    private readonly processor: ReviewRunProcessorTask,
    private readonly publisher: ReviewReportPublisherTask,
    private readonly logger: Logger,
  ) {}

  async enqueueReview(reviewRunId: string): Promise<void> {
    void this.queue
      .add(() => this.processor.process(reviewRunId))
      .catch(() => {
        this.logger.error({ reviewRunId }, "review_run.processing_failed");
      });
    this.logger.info({ reviewRunId }, "review_run.queued");
  }

  async enqueueReport(reviewReportId: string): Promise<void> {
    void this.queue
      .add(() => this.publisher.publish(reviewReportId))
      .catch(() => {
        this.logger.error({ reviewReportId }, "review_report.processing_failed");
      });
  }
}
