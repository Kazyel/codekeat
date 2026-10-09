import type { ReviewTokenUsage, ReviewUsageEvent } from "../types/review-input.types.js";
import type { ReviewRunFailureStatistics } from "../types/review-repository.types.js";
import type { ReviewModelConfiguration } from "../../models/index.js";
import { calculateReviewTokenCost } from "./review-token-cost.util.js";

const EMPTY_USAGE: ReviewTokenUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheTokens: 0,
	costUsdMicros: 0,
};

export class ReviewUsageLedger {
	private readonly calls = new Map<string, ReviewUsageEvent>();
	constructor(
		private readonly prior: ReviewRunFailureStatistics,
		private readonly model: ReviewModelConfiguration,
	) {}

	record(event: ReviewUsageEvent): void {
		const key = `${event.stage}:${event.callId}:${event.stepNumber}`;
		if (!this.calls.has(key)) this.calls.set(key, event);
	}

	usage(stage: ReviewUsageEvent["stage"]): ReviewTokenUsage | null {
		const events = [...this.calls.values()].filter((event) => event.stage === stage);
		const previous = stage === "review" ? this.prior.reviewUsage : this.prior.judgeUsage;
		if (events.length === 0 && previous === null) return null;
		// Recover fractional microdollars from the immutable pricing snapshot before rounding once.
		const initial =
			previous === null
				? EMPTY_USAGE
				: { ...previous, costUsdMicros: calculateReviewTokenCost(this.model, previous) };
		const total = events.reduce((usage, event) => addUsage(usage, event.usage), initial);
		return { ...total, costUsdMicros: Math.round(total.costUsdMicros) };
	}

	judgeCallCount(): number {
		return (
			this.prior.judgeCallCount +
			new Set(
				[...this.calls.values()]
					.filter((event) => event.stage === "judge")
					.map((event) => event.callId),
			).size
		);
	}
}

function addUsage(first: ReviewTokenUsage, second: ReviewTokenUsage): ReviewTokenUsage {
	return {
		inputTokens: first.inputTokens + second.inputTokens,
		outputTokens: first.outputTokens + second.outputTokens,
		cacheTokens: first.cacheTokens + second.cacheTokens,
		costUsdMicros: first.costUsdMicros + second.costUsdMicros,
	};
}
