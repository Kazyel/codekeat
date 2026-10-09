import { Cause, Effect, Exit, Semaphore } from "effect";
import { createReviewMetric, type ReviewMetricRecorder } from "#features/review";

// Only HTTP slots are shared. Review snapshots, content, and credentials stay invocation scoped.
export const githubContextRequests = Semaphore.makeUnsafe(16);

/** Counts actual transport attempts, including failures and interruption, without source payloads. */
export function observeGitHubContextRequest<A, E>(
	request: Effect.Effect<A, E>,
	recordMetric: ReviewMetricRecorder,
): Effect.Effect<A, E> {
	return Effect.suspend(() => {
		const startedAt = performance.now();
		return request.pipe(
			Effect.onExit((exit) =>
				Effect.sync(() =>
					recordMetric(
						createReviewMetric({
							phase: "input",
							scope: "operation",
							durationMs: performance.now() - startedAt,
							outcome: requestOutcome(exit),
							requestCount: 1,
						}),
					),
				),
			),
		);
	});
}
function requestOutcome<A, E>(exit: Exit.Exit<A, E>): "success" | "failed" | "cancelled" {
	if (Exit.isSuccess(exit)) return "success";
	return Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "failed";
}
