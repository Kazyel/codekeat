import type { LanguageModelUsage } from "ai";
import { z } from "zod";

import type { ReviewModelConfiguration } from "#features/models";
import {
	calculateReviewTokenCost,
	ReviewModelResponseError,
	type ReviewExecution,
	type ReviewTokenUsage,
	type ReviewUsageEvent,
} from "#features/review";

const TOKEN_COUNT = z.number().int().nonnegative();
const USAGE_SCHEMA = z
	.object({
		inputTokens: TOKEN_COUNT,
		outputTokens: TOKEN_COUNT,
		inputTokenDetails: z.object({ cacheReadTokens: TOKEN_COUNT.optional().default(0) }),
	})
	.refine((usage) => usage.inputTokenDetails.cacheReadTokens <= usage.inputTokens);
const GOOGLE_USAGE_SCHEMA = z
	.object({
		promptTokenCount: TOKEN_COUNT,
		cachedContentTokenCount: TOKEN_COUNT.optional().default(0),
		candidatesTokenCount: TOKEN_COUNT.optional().default(0),
		thoughtsTokenCount: TOKEN_COUNT.optional().default(0),
		toolUsePromptTokenCount: TOKEN_COUNT.optional().default(0),
	})
	.refine((usage) => usage.cachedContentTokenCount <= usage.promptTokenCount);

/** Records completed provider calls independently of findings, tools and fallback attempts. */
export class ReviewUsageRecorder {
	private readonly events = new Map<string, ReviewTokenUsage>();
	private failure: Error | null = null;
	constructor(
		private readonly model: ReviewModelConfiguration,
		private readonly stage: ReviewUsageEvent["stage"],
		private readonly execution: ReviewExecution,
	) {}

	record(event: {
		readonly callId: string;
		readonly stepNumber: number;
		readonly usage: LanguageModelUsage;
	}): void {
		try {
			this.recordValidated(event);
		} catch (error) {
			this.failure ??=
				error instanceof Error
					? error
					: new ReviewModelResponseError("usage_metadata_invalid");
		}
	}

	throwIfFailed(): void {
		if (this.failure !== null) throw this.failure;
	}

	private recordValidated(event: {
		readonly callId: string;
		readonly stepNumber: number;
		readonly usage: LanguageModelUsage;
	}): void {
		this.throwIfFailed();
		const key = `${event.callId}:${event.stepNumber}`;
		if (this.events.has(key)) return;
		const usage = parseTokenUsage(event.usage, this.model);
		this.execution.recordUsage({
			stage: this.stage,
			callId: event.callId,
			stepNumber: event.stepNumber,
			usage,
		});
		this.events.set(key, usage);
	}

	snapshot(): ReviewTokenUsage {
		this.throwIfFailed();
		return [...this.events.values()].reduce(
			(total, usage) => ({
				inputTokens: total.inputTokens + usage.inputTokens,
				outputTokens: total.outputTokens + usage.outputTokens,
				cacheTokens: total.cacheTokens + usage.cacheTokens,
				costUsdMicros: total.costUsdMicros + usage.costUsdMicros,
			}),
			{ inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsdMicros: 0 },
		);
	}
}

function parseTokenUsage(
	usage: LanguageModelUsage,
	model: ReviewModelConfiguration,
): ReviewTokenUsage {
	const parsed = USAGE_SCHEMA.safeParse(usage);
	if (!parsed.success || !GOOGLE_USAGE_SCHEMA.safeParse(usage.raw).success) {
		throw new ReviewModelResponseError("usage_metadata_invalid");
	}
	const { inputTokens, outputTokens } = parsed.data;
	const cacheTokens = parsed.data.inputTokenDetails.cacheReadTokens;
	const costUsdMicros = calculateReviewTokenCost(model, {
		inputTokens,
		outputTokens,
		cacheTokens,
	});
	return { inputTokens, outputTokens, cacheTokens, costUsdMicros };
}
