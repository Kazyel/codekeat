import type { ReviewModelConfiguration } from "../../models/index.js";
import type { ReviewTokenUsage } from "../types/review-input.types.js";

export function calculateReviewTokenCost(
	model: ReviewModelConfiguration,
	usage: Pick<ReviewTokenUsage, "inputTokens" | "outputTokens" | "cacheTokens">,
): number {
	if (usage.inputTokens === 0 && usage.outputTokens === 0) return 0;

	const uncachedInputTokens = usage.inputTokens - usage.cacheTokens;
	if (uncachedInputTokens === 0) return 0;

	return (
		(uncachedInputTokens * model.inputNanoUsdPerToken +
			usage.cacheTokens * model.cachedInputNanoUsdPerToken +
			usage.outputTokens * model.outputNanoUsdPerToken) /
		1_000
	);
}
