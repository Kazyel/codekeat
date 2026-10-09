import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { ReviewQueueService } from "#features/review";

describe("ReviewQueueService", () => {
	it.each([1, 5])(
		"schedules at most %i reviews without waiting for completion and fills each freed slot",
		async (concurrency) => {
			const reviews = new DeferredTasks();
			const queue = new ReviewQueueService(
				{ process: (id) => reviews.run(id) },
				{ async publish() {} },
				pino({ enabled: false }),
				concurrency,
			);
			const ids = Array.from({ length: concurrency + 1 }, (_, index) => `review-${index}`);

			try {
				for (const id of ids) await queue.enqueueReview(id);

				expect(reviews.startedIds).toEqual(ids.slice(0, concurrency));
				reviews.complete("review-0");
				await vi.waitFor(() => expect(reviews.startedIds).toEqual(ids));
			} finally {
				reviews.completeAll();
			}
		},
	);

	it("frees a failed review's slot while another review is still running", async () => {
		const reviews = new DeferredTasks();
		const logger = pino({ enabled: false });
		const logError = vi.spyOn(logger, "error");
		const queue = new ReviewQueueService(
			{ process: (id) => reviews.run(id) },
			{ async publish() {} },
			logger,
			2,
		);

		try {
			await queue.enqueueReview("review-1");
			await queue.enqueueReview("review-2");
			await queue.enqueueReview("review-3");
			expect(reviews.startedIds).toEqual(["review-1", "review-2"]);

			reviews.fail("review-1");
			await vi.waitFor(() => {
				expect(reviews.startedIds).toEqual(["review-1", "review-2", "review-3"]);
				expect(logError).toHaveBeenCalledWith(
					{ reviewRunId: "review-1" },
					"review_run.processing_failed",
				);
			});
		} finally {
			reviews.completeAll();
		}
	});

	it("publishes reports serially while every review slot is occupied", async () => {
		const reviews = new DeferredTasks();
		const reports = new DeferredTasks();
		const queue = new ReviewQueueService(
			{ process: (id) => reviews.run(id) },
			{ publish: (id) => reports.run(id) },
			pino({ enabled: false }),
			2,
		);

		try {
			await queue.enqueueReview("review-1");
			await queue.enqueueReview("review-2");
			await queue.enqueueReport("report-1");
			await queue.enqueueReport("report-2");
			expect(reviews.startedIds).toEqual(["review-1", "review-2"]);
			expect(reports.startedIds).toEqual(["report-1"]);

			reports.complete("report-1");
			await vi.waitFor(() => expect(reports.startedIds).toEqual(["report-1", "report-2"]));
		} finally {
			reviews.completeAll();
			reports.completeAll();
		}
	});
});

class DeferredTasks {
	readonly startedIds: string[] = [];
	private readonly tasks = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();

	async run(id: string): Promise<void> {
		const task = Promise.withResolvers<void>();
		this.tasks.set(id, task);
		this.startedIds.push(id);
		await task.promise;
	}

	complete(id: string): void {
		this.tasks.get(id)?.resolve();
	}

	fail(id: string): void {
		this.tasks.get(id)?.reject(new Error("Processing failed."));
	}

	completeAll(): void {
		for (const task of this.tasks.values()) task.resolve();
	}
}
