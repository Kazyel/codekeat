import pino from "pino";
import { describe, expect, it } from "vitest";

import type {
  ReviewReportPublisherTask,
  ReviewRunProcessorTask,
} from "../src/modules/review/review-run.js";
import { LocalReviewWorkQueue } from "../src/modules/review/review-run-queue.js";

describe("LocalReviewWorkQueue", () => {
  it("returns after scheduling work without waiting for the review", async () => {
    const processor = new DeferredProcessor();
    const queue = new LocalReviewWorkQueue(
      processor,
      new RecordedPublisher(),
      pino({ enabled: false }),
    );

    await queue.enqueueReview("review-run-1");

    expect(processor.reviewRunIds).toEqual(["review-run-1"]);
    processor.complete();
  });
});

class DeferredProcessor implements ReviewRunProcessorTask {
  readonly reviewRunIds: string[] = [];
  private resolveProcessing: (() => void) | null = null;

  async process(reviewRunId: string): Promise<void> {
    this.reviewRunIds.push(reviewRunId);
    await new Promise<void>((resolve) => {
      this.resolveProcessing = resolve;
    });
  }

  complete(): void {
    this.resolveProcessing?.();
  }
}

class RecordedPublisher implements ReviewReportPublisherTask {
  async publish(): Promise<void> {}
}
