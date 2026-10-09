import type { DatabaseConnection } from "@codekeat/database";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { ReviewTelemetrySummary } from "../types/review-metrics.types.js";
import type { ReviewUsageGroup } from "../types/review-repository.types.js";

const count = z.number().int().nonnegative();
const summaryRow = z
	.object({
		period: z.string(),
		phase: z.enum(["queue", "input", "prepare", "count", "generation", "tool", "judge"]),
		scope: z.enum(["phase", "operation"]),
		sizeBand: z.enum(["small", "medium", "large", "unknown"]),
		sampleCount: count,
		runCount: count,
		p50DurationMs: count,
		p95DurationMs: count,
		failureCount: count,
		cancelledCount: count,
		ignoredCount: count,
		requestCount: count,
		cacheHitCount: count,
		retryCount: count,
		capacityFailureCount: count,
		peakRssBytes: count,
		knownUsageCount: count,
		inputTokens: count.nullable(),
		outputTokens: count.nullable(),
		cacheTokens: count.nullable(),
		costUsdMicros: z.number().nonnegative().nullable(),
	})
	.strict();
type SummaryRow = z.infer<typeof summaryRow>;

/** SQLite ranks durations and returns only aggregate rows, rather than every event to Node. */
export function queryReviewTelemetrySummaries(
	connection: DatabaseConnection,
	groupBy: ReviewUsageGroup,
	since: string,
	repositoryFullName: string | undefined,
): readonly ReviewTelemetrySummary[] {
	const repositoryFilter =
		repositoryFullName === undefined
			? sql`1=1`
			: sql`r.owner_login || '/' || r.name = ${repositoryFullName}`;
	const rows = connection.db.all(sql`
		WITH events AS (
			SELECT e.* FROM review_telemetry e
			JOIN review_runs run ON run.id=e.review_run_id
			JOIN repositories r ON r.github_repository_id=run.github_repository_id
			WHERE e.created_at >= ${since} AND ${repositoryFilter}
		), sizes AS (
			SELECT review_run_id,max(diff_bytes) bytes FROM review_telemetry
			WHERE phase='input' AND scope='phase' AND review_run_id IN (SELECT DISTINCT review_run_id FROM events)
			GROUP BY review_run_id
		), labeled AS (
			SELECT e.*,${periodExpression(groupBy)} period,
				CASE WHEN sizes.bytes IS NULL THEN 'unknown' WHEN sizes.bytes<=65536 THEN 'small' WHEN sizes.bytes<=524288 THEN 'medium' ELSE 'large' END size_band
			FROM events e LEFT JOIN sizes ON sizes.review_run_id=e.review_run_id
		), ranked AS (
			SELECT *,row_number() OVER (PARTITION BY period,phase,scope,size_band ORDER BY duration_ms,id) position,
				count(*) OVER (PARTITION BY period,phase,scope,size_band) population
			FROM labeled
		)
		SELECT period,phase,scope,size_band AS sizeBand,count(*) AS sampleCount,count(DISTINCT review_run_id) AS runCount,
			max(CASE WHEN position=(population+1)/2 THEN duration_ms END) AS p50DurationMs,
			max(CASE WHEN position=(population*95+99)/100 THEN duration_ms END) AS p95DurationMs,
			sum(outcome='failed') AS failureCount,sum(outcome='cancelled') AS cancelledCount,sum(outcome='ignored') AS ignoredCount,
			sum(request_count) AS requestCount,sum(cache_hit_count) AS cacheHitCount,sum(retry_count) AS retryCount,
			sum(capacity_failure) AS capacityFailureCount,max(peak_rss_bytes) AS peakRssBytes,count(input_tokens) AS knownUsageCount,
			sum(input_tokens) AS inputTokens,sum(output_tokens) AS outputTokens,sum(cache_tokens) AS cacheTokens,sum(cost_usd_micros) AS costUsdMicros
		FROM ranked GROUP BY period,phase,scope,size_band ORDER BY period,phase,scope,size_band
	`);
	return z.array(summaryRow).parse(rows).map(toSummary);
}
function periodExpression(groupBy: ReviewUsageGroup): SQL {
	if (groupBy === "day") return sql`substr(e.created_at,1,10)`;
	if (groupBy === "month") return sql`substr(e.created_at,1,7)`;
	return sql`date(e.created_at,printf('-%d days',(cast(strftime('%w',e.created_at) AS integer)+6)%7))`;
}
function toSummary(row: SummaryRow): ReviewTelemetrySummary {
	const { inputTokens, outputTokens, cacheTokens, costUsdMicros, ...summary } = row;
	const usage =
		row.knownUsageCount === 0
			? null
			: z
					.object({
						inputTokens: count,
						outputTokens: count,
						cacheTokens: count,
						costUsdMicros: z.number().nonnegative(),
					})
					.strict()
					.refine((value) => value.cacheTokens <= value.inputTokens)
					.parse({ inputTokens, outputTokens, cacheTokens, costUsdMicros });
	return { ...summary, usage };
}
