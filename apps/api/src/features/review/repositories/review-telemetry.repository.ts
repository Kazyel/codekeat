import { randomUUID } from "node:crypto";

import { type DatabaseConnection, reviewRuns, reviewTelemetry } from "@codekeat/database";
import { and, asc, eq, gt, or } from "drizzle-orm";

import { currentTimestamp } from "#shared/database";
import {
	reviewMetricSchema,
	reviewMetricEventSchema,
	type ReviewMetric,
	type ReviewMetricEvent,
	type ReviewTelemetrySummary,
	type ReviewTelemetryCursor,
	type ReviewTelemetryPage,
} from "../types/review-metrics.types.js";
import type { ReviewUsageGroup } from "../types/review-repository.types.js";

import { queryReviewTelemetrySummaries } from "./review-telemetry-summary.query.js";
type TelemetryRow = typeof reviewTelemetry.$inferSelect;

export class ReviewTelemetryRepository {
	constructor(private readonly connection: DatabaseConnection) {}

	record(reviewRunId: string, metric: ReviewMetric): void {
		const validated = reviewMetricSchema.parse(metric);
		const { usage, ...fields } = validated;
		this.connection.db
			.insert(reviewTelemetry)
			.values({
				...fields,
				id: randomUUID(),
				reviewRunId,
				...usageColumns(usage),
				createdAt: currentTimestamp(),
			})
			.run();
	}

	findRunEvents(
		reviewRunId: string,
		limit = 200,
		cursor: ReviewTelemetryCursor | null = null,
	): ReviewTelemetryPage | null {
		const run = this.connection.db
			.select({ id: reviewRuns.id })
			.from(reviewRuns)
			.where(eq(reviewRuns.id, reviewRunId))
			.get();
		if (run === undefined) return null;
		const rows = this.connection.db
			.select()
			.from(reviewTelemetry)
			.where(and(eq(reviewTelemetry.reviewRunId, reviewRunId), afterCursor(cursor)))
			.orderBy(asc(reviewTelemetry.createdAt), asc(reviewTelemetry.id))
			.limit(limit + 1)
			.all()
			.map(toEvent);
		return eventPage(rows, limit);
	}

	listSummaries(
		groupBy: ReviewUsageGroup,
		since: string,
		repositoryFullName?: string,
	): readonly ReviewTelemetrySummary[] {
		return queryReviewTelemetrySummaries(this.connection, groupBy, since, repositoryFullName);
	}
}

function usageColumns(
	usage: ReviewMetric["usage"],
): Pick<TelemetryRow, "inputTokens" | "outputTokens" | "cacheTokens" | "costUsdMicros"> {
	if (usage !== null) return usage;
	return { inputTokens: null, outputTokens: null, cacheTokens: null, costUsdMicros: null };
}

function eventPage(rows: readonly ReviewMetricEvent[], limit: number): ReviewTelemetryPage {
	const events = rows.slice(0, limit);
	if (rows.length <= limit) return { events, nextCursor: null };
	const last = events.at(-1)!;
	return { events, nextCursor: { createdAt: last.createdAt, id: last.id } };
}

function toEvent(row: TelemetryRow): ReviewMetricEvent {
	const {
		id,
		reviewRunId,
		createdAt,
		inputTokens,
		outputTokens,
		cacheTokens,
		costUsdMicros,
		...fields
	} = row;
	const absent = [inputTokens, outputTokens, cacheTokens, costUsdMicros].every(
		(value) => value === null,
	);
	return reviewMetricEventSchema.parse({
		...fields,
		usage: absent ? null : { inputTokens, outputTokens, cacheTokens, costUsdMicros },
		id,
		reviewRunId,
		createdAt,
	});
}

function afterCursor(cursor: ReviewTelemetryCursor | null): ReturnType<typeof or> {
	if (cursor === null) return undefined;
	return or(
		gt(reviewTelemetry.createdAt, cursor.createdAt),
		and(eq(reviewTelemetry.createdAt, cursor.createdAt), gt(reviewTelemetry.id, cursor.id)),
	);
}
