import type { ReviewModelConfiguration } from "../../models/index.js";
import type { ReviewTokenUsage } from "../types/review-input.types.js";

export function calculateReviewTokenCost(
	model: ReviewModelConfiguration,
	usage: Pick<ReviewTokenUsage, "inputTokens" | "outputTokens" | "cacheTokens">,
): number {
	return (
		((usage.inputTokens - usage.cacheTokens) * model.inputNanoUsdPerToken +
			usage.cacheTokens * model.cachedInputNanoUsdPerToken +
			usage.outputTokens * model.outputNanoUsdPerToken) /
		1_000
	);
}
