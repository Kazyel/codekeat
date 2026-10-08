import { queryOptions } from "@tanstack/react-query";

import {
	getAnalyticsFn,
	getConnectionsFn,
	getModelsFn,
	getOverviewFn,
	getReviewDetailFn,
	getReviewRunsFn,
} from "@/lib/data.functions";
import type { AnalyticsInput, ReviewRunSummary } from "@/lib/api-contracts";

export const overviewQuery = queryOptions({
	queryKey: ["overview"],
	queryFn: () => getOverviewFn(),
	refetchInterval: (query) => (query.state.data?.runs.some(needsReviewRefresh) ? 10_000 : false),
});

export const reviewRunsQuery = queryOptions({
	queryKey: ["review-runs"],
	queryFn: () => getReviewRunsFn(),
	refetchInterval: (query) => (query.state.data?.some(needsReviewRefresh) ? 10_000 : false),
});

export function reviewDetailQuery(id: string) {
	return queryOptions({
		queryKey: ["review-run", id],
		queryFn: () => getReviewDetailFn({ data: { id } }),
		refetchInterval: (query) =>
			query.state.data && needsReviewRefresh(query.state.data) ? 10_000 : false,
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

function needsReviewRefresh(run: ReviewRunSummary): boolean {
	if (run.status !== "completed") return run.status === "queued" || run.status === "running";
	return run.reviewReportStatus === "pending" || run.reviewReportStatus === "publishing";
}
