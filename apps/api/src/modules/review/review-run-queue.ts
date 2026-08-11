import PQueue from "p-queue";
import type { Logger } from "pino";

import type { ReviewRunQueue } from "./review-run.js";

export class LocalReviewRunQueue implements ReviewRunQueue {
  private readonly queue = new PQueue({ concurrency: 1 });

  constructor(private readonly logger: Logger) {}

  async enqueue(reviewRunId: string): Promise<void> {
    await this.queue.add(async () => {
      this.logger.info({ reviewRunId }, "review_run.queued");
    });
  }
}
