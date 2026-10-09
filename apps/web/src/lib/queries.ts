import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
	getAnalyticsFn,
	getConnectionsFn,
	getModelsFn,
	getOverviewFn,
	getReviewDetailFn,
	getReviewRunsFn,
	getReviewTelemetryFn,
	getTelemetrySummaryFn,
} from "@/lib/data.functions";
import type { AnalyticsInput, ReviewRunSummary } from "@/lib/api-contracts";

const INITIAL_TELEMETRY_PAGE: { readonly cursor: string | null } = { cursor: null };

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

export function reviewTelemetryQuery(id: string, active: boolean) {
	return infiniteQueryOptions({
		queryKey: ["review-telemetry", id],
		initialPageParam: INITIAL_TELEMETRY_PAGE,
		queryFn: ({ pageParam }) =>
			getReviewTelemetryFn({ data: { id, cursor: pageParam.cursor ?? undefined } }),
		getNextPageParam: (page) =>
			page.nextCursor === null ? undefined : { cursor: page.nextCursor },
		refetchInterval: active ? 10_000 : false,
	});
}

export function telemetrySummaryQuery(input: AnalyticsInput) {
	return queryOptions({
		queryKey: ["review-telemetry-summary", input],
		queryFn: () => getTelemetrySummaryFn({ data: input }),
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
