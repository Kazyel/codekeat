import type { ReviewQuality, ReviewUsage } from "@/lib/api-contracts";

export interface AnalyticsPoint {
	readonly period: string;
	readonly tokens: number;
	readonly cost: number;
	readonly accepted: number;
	readonly completed: number;
	readonly approval: number | null;
}

export function mergeAnalytics(
	usage: readonly ReviewUsage[],
	quality: readonly ReviewQuality[],
): readonly AnalyticsPoint[] {
	const result = new Map<
		string,
		{
			period: string;
			tokens: number;
			cost: number;
			accepted: number;
			completed: number;
			evaluated: number;
		}
	>();
	for (const item of usage) {
		const point = result.get(item.period) ?? {
			period: item.period,
			tokens: 0,
			cost: 0,
			accepted: 0,
			completed: 0,
			evaluated: 0,
		};
		// Cached tokens are already included in the total input count.
		point.tokens += item.inputTokens + item.outputTokens;
		point.cost += item.costUsdMicros;
		result.set(item.period, point);
	}
	for (const item of quality) {
		const point = result.get(item.period) ?? {
			period: item.period,
			tokens: 0,
			cost: 0,
			accepted: 0,
			completed: 0,
			evaluated: 0,
		};
		point.accepted += item.acceptedFindingCount;
		point.completed += item.completedRunCount;
		point.evaluated += item.evaluatedFindingCount;
		result.set(item.period, point);
	}
	return [...result.values()]
		.toSorted((left, right) => left.period.localeCompare(right.period))
		.map((point) => ({
			...point,
			approval:
				point.evaluated === 0
					? null
					: Math.round((point.accepted / point.evaluated) * 10_000),
		}));
}
