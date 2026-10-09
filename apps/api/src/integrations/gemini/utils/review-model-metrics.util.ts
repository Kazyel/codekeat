import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import {
	createReviewMetric,
	type ReviewExecution,
	type ReviewMetric,
	type ReviewUsageEvent,
} from "#features/review";

interface ModelMetricContext {
	readonly execution: ReviewExecution;
	readonly attemptId: string;
	readonly stage: "review" | "judge";
	readonly completedResponses: Map<string, ReviewMetric>;
	readonly reasoningTokens: Map<string, number>;
	callId: string | null;
	requestsInCall: number;
}

const modelMetrics = new AsyncLocalStorage<ModelMetricContext>();

/** Carries run metrics through the SDK's fetch boundary without exposing prompts in telemetry. */
export function withReviewModelMetrics<T>(
	execution: ReviewExecution,
	stage: "review" | "judge",
	request: () => Promise<T>,
): Promise<T> {
	const context: ModelMetricContext = {
		execution,
		stage,
		attemptId: randomUUID(),
		callId: null,
		requestsInCall: 0,
		completedResponses: new Map(),
		reasoningTokens: new Map(),
	};
	return modelMetrics.run(context, async () => {
		try {
			return await request();
		} finally {
			// Missing or invalid usage stays unknown, while the actual transport duration survives.
			for (const metric of context.completedResponses.values())
				execution.recordMetric(metric);
			context.completedResponses.clear();
			context.reasoningTokens.clear();
		}
	});
}

/** Persist validated provider receipts before attaching usage to the matching transport sample. */
export function withReviewUsageMetrics(execution: ReviewExecution): ReviewExecution {
	return {
		...execution,
		recordUsage: (event) => {
			execution.recordUsage(event);
			attachModelUsage(event);
		},
	};
}

export async function observeModelPreparation<T>(
	signal: AbortSignal,
	prepare: () => Promise<T>,
): Promise<T> {
	const metrics = captureModelMetrics();
	const startedAt = performance.now();
	let outcome: ReviewMetric["outcome"] = "success";
	try {
		return await prepare();
	} catch (error) {
		outcome = signal.aborted ? "cancelled" : "failed";
		throw error;
	} finally {
		metrics.record({ phase: "prepare", durationMs: performance.now() - startedAt, outcome });
	}
}

export interface CapturedModelMetrics {
	readonly phase: "generation" | "judge";
	record(input: Parameters<typeof createReviewMetric>[0]): void;
	requestAttempt(): number;
}

/** Capture before entering Effect: fibers may resume under another async scheduler context. */
export function captureModelMetrics(): CapturedModelMetrics {
	const context = modelMetrics.getStore();
	const callId = context?.callId ?? null;
	return {
		phase: context?.stage === "judge" ? "judge" : "generation",
		record: (input) => {
			if (context === undefined) return;
			const metric = createReviewMetric({ ...input, attemptId: context.attemptId, callId });
			if (completedModelResponse(metric) && callId !== null) {
				context.completedResponses.set(callId, metric);
				return;
			}
			context.execution.recordMetric(metric);
		},
		requestAttempt: () => (context === undefined ? 0 : Number(context.requestsInCall++ > 0)),
	};
}

export function beginModelCall(callId: string): void {
	const context = modelMetrics.getStore();
	if (context === undefined) return;
	context.callId = callId;
	context.requestsInCall = 0;
}

/** Numeric receipt detail only; it is persisted with the matching validated usage event. */
export function attachModelReasoningTokens(callId: string, reasoningTokens: number): void {
	modelMetrics.getStore()?.reasoningTokens.set(callId, reasoningTokens);
}

function attachModelUsage(event: ReviewUsageEvent): void {
	const context = modelMetrics.getStore();
	if (context?.stage !== event.stage) return;
	const metric = context.completedResponses.get(event.callId);
	if (metric === undefined) return;
	context.execution.recordMetric(
		createReviewMetric({
			...metric,
			usage: event.usage,
			reasoningTokens: context.reasoningTokens.get(event.callId) ?? null,
		}),
	);
	context.completedResponses.delete(event.callId);
	context.reasoningTokens.delete(event.callId);
}

function completedModelResponse(metric: ReviewMetric): boolean {
	return (
		(metric.phase === "generation" || metric.phase === "judge") && metric.outcome === "success"
	);
}
