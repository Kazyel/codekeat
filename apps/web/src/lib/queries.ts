import { queryOptions } from "@tanstack/react-query";

import {
	getAnalyticsFn,
	getConnectionsFn,
	getModelsFn,
	getOverviewFn,
	getReviewDetailFn,
	getReviewRunsFn,
} from "@/lib/data.functions";
import type { AnalyticsInput } from "@/lib/api-contracts";

export const overviewQuery = queryOptions({
	queryKey: ["overview"],
	queryFn: () => getOverviewFn(),
	refetchInterval: (query) =>
		query.state.data?.runs.some((run) => run.status === "queued" || run.status === "running")
			? 10_000
			: false,
});

export const reviewRunsQuery = queryOptions({
	queryKey: ["review-runs"],
	queryFn: () => getReviewRunsFn(),
	refetchInterval: (query) =>
		query.state.data?.some((run) => run.status === "queued" || run.status === "running")
			? 10_000
			: false,
});

export function reviewDetailQuery(id: string) {
	return queryOptions({
		queryKey: ["review-run", id],
		queryFn: () => getReviewDetailFn({ data: { id } }),
	});
}

export function analyticsQuery(input: AnalyticsInput) {
	return queryOptions({
		queryKey: ["analytics", input],
		queryFn: () => getAnalyticsFn({ data: input }),
	});
}

export const connectionsQuery = queryOptions({
	queryKey: ["connections"],
	queryFn: () => getConnectionsFn(),
});

export const modelsQuery = queryOptions({
	queryKey: ["models"],
	queryFn: () => getModelsFn(),
});
