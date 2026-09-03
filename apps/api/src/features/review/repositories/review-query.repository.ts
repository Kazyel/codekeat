import {
	type DatabaseConnection,
	findings,
	repositories,
	reviewReports,
	reviewRuns,
} from "@codekeat/database";
import { and, asc, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";

import type {
	ReviewQualitySummary,
	ReviewRunDetail,
	ReviewRunSummary,
	ReviewUsageGroup,
	ReviewUsageSummary,
} from "../types/review-repository.types.js";

const REVIEW_RUN_LIST_LIMIT = 50;
const REPOSITORY_FULL_NAME = sql<string>`${repositories.ownerLogin} || '/' || ${repositories.name}`;
const REVIEW_USAGE_PERIOD: Readonly<Record<ReviewUsageGroup, SQL<string>>> = {
	day: sql<string>`substr(${reviewRuns.completedAt}, 1, 10)`,
	week: sql<string>`date(${reviewRuns.completedAt}, 'weekday 0', '-6 days')`,
	month: sql<string>`substr(${reviewRuns.completedAt}, 1, 7)`,
};

export class ReviewQueryRepository {
	constructor(private readonly connection: DatabaseConnection) {}

	listReviewRunSummaries(): readonly ReviewRunSummary[] {
		const publishedFindingCounts = this.connection.db
			.select({
				reviewRunId: findings.reviewRunId,
				findingCount: sql<number>`count(*)`.as("finding_count"),
			})
			.from(findings)
			.where(eq(findings.includedInReport, true))
			.groupBy(findings.reviewRunId)
			.as("published_finding_counts");
		const rows = this.connection.db
			.select({
				id: reviewRuns.id,
				repositoryFullName: REPOSITORY_FULL_NAME,
				pullRequestNumber: reviewRuns.pullRequestNumber,
				headSha: reviewRuns.headSha,
				trigger: reviewRuns.trigger,
				status: reviewRuns.status,
				modelName: reviewRuns.modelName,
				findingCount: sql<number>`coalesce(${publishedFindingCounts.findingCount}, 0)`,
				createdAt: reviewRuns.createdAt,
				completedAt: reviewRuns.completedAt,
				inputTokens: reviewRuns.inputTokens,
				outputTokens: reviewRuns.outputTokens,
				cacheTokens: reviewRuns.cacheTokens,
				costUsdMicros: reviewRuns.costUsdMicros,
				judgeInputTokens: reviewRuns.judgeInputTokens,
				judgeOutputTokens: reviewRuns.judgeOutputTokens,
				judgeCacheTokens: reviewRuns.judgeCacheTokens,
				judgeCostUsdMicros: reviewRuns.judgeCostUsdMicros,
				reviewStrategyVersion: reviewRuns.reviewStrategyVersion,
				changedLineCount: reviewRuns.changedLineCount,
				reviewChunkCount: reviewRuns.reviewChunkCount,
				judgeCallCount: reviewRuns.judgeCallCount,
				processingDurationMs: reviewRuns.processingDurationMs,
				reviewReportStatus: reviewReports.status,
				githubCommentUrl: reviewReports.githubCommentUrl,
			})
			.from(reviewRuns)
			.innerJoin(
				repositories,
				eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId),
			)
			.leftJoin(publishedFindingCounts, eq(publishedFindingCounts.reviewRunId, reviewRuns.id))
			.leftJoin(reviewReports, eq(reviewReports.reviewRunId, reviewRuns.id))
			.orderBy(desc(reviewRuns.createdAt))
			.limit(REVIEW_RUN_LIST_LIMIT)
			.all();

		return rows.map(toReviewRunSummary);
	}

	listReviewUsage(
		groupBy: ReviewUsageGroup,
		repositoryFullName?: string,
	): readonly ReviewUsageSummary[] {
		const period = REVIEW_USAGE_PERIOD[groupBy];
		const rows = this.connection.db
			.select({
				period,
				repositoryFullName: REPOSITORY_FULL_NAME,
				inputTokens: sql<number>`coalesce(sum(${reviewRuns.inputTokens}), 0)`,
				outputTokens: sql<number>`coalesce(sum(${reviewRuns.outputTokens}), 0)`,
				cacheTokens: sql<number>`coalesce(sum(${reviewRuns.cacheTokens}), 0)`,
				costUsdMicros: sql<number>`coalesce(sum(${reviewRuns.costUsdMicros}), 0)`,
			})
			.from(reviewRuns)
			.innerJoin(
				repositories,
				eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId),
			)
			.where(
				and(
					eq(reviewRuns.status, "completed"),
					isNotNull(reviewRuns.completedAt),
					isNotNull(reviewRuns.inputTokens),
					repositoryFullName === undefined
						? undefined
						: eq(REPOSITORY_FULL_NAME, repositoryFullName),
				),
			)
			.groupBy(period, REPOSITORY_FULL_NAME)
			.orderBy(asc(period), asc(REPOSITORY_FULL_NAME))
			.all();

		return rows.map((row) => ({
			...row,
			inputTokens: Number(row.inputTokens),
			outputTokens: Number(row.outputTokens),
			cacheTokens: Number(row.cacheTokens),
			costUsdMicros: Number(row.costUsdMicros),
		}));
	}

	listReviewQuality(
		groupBy: ReviewUsageGroup,
		repositoryFullName?: string,
	): readonly ReviewQualitySummary[] {
		const period = REVIEW_USAGE_PERIOD[groupBy];
		const findingMetrics = this.connection.db
			.select({
				reviewRunId: findings.reviewRunId,
				evaluatedFindingCount:
					sql<number>`sum(case when ${findings.judgeVerdict} <> 'not_evaluated' then 1 else 0 end)`.as(
						"evaluated_finding_count",
					),
				approvedFindingCount:
					sql<number>`sum(case when ${findings.judgeVerdict} = 'approved' then 1 else 0 end)`.as(
						"approved_finding_count",
					),
				rejectedFindingCount:
					sql<number>`sum(case when ${findings.judgeVerdict} = 'rejected' then 1 else 0 end)`.as(
						"rejected_finding_count",
					),
				severityChangedFindingCount:
					sql<number>`sum(case when ${findings.judgeVerdict} = 'severity_changed' then 1 else 0 end)`.as(
						"severity_changed_finding_count",
					),
			})
			.from(findings)
			.groupBy(findings.reviewRunId)
			.as("finding_metrics");
		const evaluated = sql<number>`coalesce(sum(${findingMetrics.evaluatedFindingCount}), 0)`;
		const approved = sql<number>`coalesce(sum(${findingMetrics.approvedFindingCount}), 0)`;
		const rejected = sql<number>`coalesce(sum(${findingMetrics.rejectedFindingCount}), 0)`;
		const changed = sql<number>`coalesce(sum(${findingMetrics.severityChangedFindingCount}), 0)`;
		const accepted = sql<number>`(${approved} + ${changed})`;
		const changedLines = sql<number>`coalesce(sum(${reviewRuns.changedLineCount}), 0)`;
		const rows = this.connection.db
			.select({
				period,
				repositoryFullName: REPOSITORY_FULL_NAME,
				reviewStrategyVersion: reviewRuns.reviewStrategyVersion,
				evaluatedFindingCount: evaluated,
				approvedFindingCount: approved,
				rejectedFindingCount: rejected,
				severityChangedFindingCount: changed,
				acceptedFindingCount: accepted,
				judgeApprovalRateBasisPoints: sql<
					number | null
				>`case when ${evaluated} = 0 then null else round(${accepted} * 10000.0 / ${evaluated}) end`,
				acceptedFindingsPerThousandChangedLines: sql<
					number | null
				>`case when ${changedLines} = 0 then null else ${accepted} * 1000.0 / ${changedLines} end`,
				changedLineCount: changedLines,
				completedRunCount: sql<number>`count(${reviewRuns.id})`,
				reviewInputTokens: sql<number>`coalesce(sum(${reviewRuns.inputTokens}), 0)`,
				reviewOutputTokens: sql<number>`coalesce(sum(${reviewRuns.outputTokens}), 0)`,
				reviewCacheTokens: sql<number>`coalesce(sum(${reviewRuns.cacheTokens}), 0)`,
				reviewCostUsdMicros: sql<number>`coalesce(sum(${reviewRuns.costUsdMicros}), 0)`,
				judgeInputTokens: sql<number>`coalesce(sum(${reviewRuns.judgeInputTokens}), 0)`,
				judgeOutputTokens: sql<number>`coalesce(sum(${reviewRuns.judgeOutputTokens}), 0)`,
				judgeCacheTokens: sql<number>`coalesce(sum(${reviewRuns.judgeCacheTokens}), 0)`,
				judgeCostUsdMicros: sql<number>`coalesce(sum(${reviewRuns.judgeCostUsdMicros}), 0)`,
				judgeCallCount: sql<number>`coalesce(sum(${reviewRuns.judgeCallCount}), 0)`,
				averageProcessingDurationMs: sql<number>`round(avg(${reviewRuns.processingDurationMs}))`,
			})
			.from(reviewRuns)
			.innerJoin(
				repositories,
				eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId),
			)
			.leftJoin(findingMetrics, eq(findingMetrics.reviewRunId, reviewRuns.id))
			.where(
				and(
					eq(reviewRuns.status, "completed"),
					isNotNull(reviewRuns.completedAt),
					isNotNull(reviewRuns.reviewStrategyVersion),
					repositoryFullName === undefined
						? undefined
						: eq(REPOSITORY_FULL_NAME, repositoryFullName),
				),
			)
			.groupBy(period, REPOSITORY_FULL_NAME, reviewRuns.reviewStrategyVersion)
			.orderBy(asc(period), asc(REPOSITORY_FULL_NAME), asc(reviewRuns.reviewStrategyVersion))
			.all();

		return rows.map((row) => ({
			...row,
			reviewStrategyVersion: row.reviewStrategyVersion!,
			evaluatedFindingCount: Number(row.evaluatedFindingCount),
			approvedFindingCount: Number(row.approvedFindingCount),
			rejectedFindingCount: Number(row.rejectedFindingCount),
			severityChangedFindingCount: Number(row.severityChangedFindingCount),
			acceptedFindingCount: Number(row.acceptedFindingCount),
			judgeApprovalRateBasisPoints:
				row.judgeApprovalRateBasisPoints === null
					? null
					: Number(row.judgeApprovalRateBasisPoints),
			acceptedFindingsPerThousandChangedLines:
				row.acceptedFindingsPerThousandChangedLines === null
					? null
					: Number(row.acceptedFindingsPerThousandChangedLines),
			changedLineCount: Number(row.changedLineCount),
			completedRunCount: Number(row.completedRunCount),
			reviewInputTokens: Number(row.reviewInputTokens),
			reviewOutputTokens: Number(row.reviewOutputTokens),
			reviewCacheTokens: Number(row.reviewCacheTokens),
			reviewCostUsdMicros: Number(row.reviewCostUsdMicros),
			judgeInputTokens: Number(row.judgeInputTokens),
			judgeOutputTokens: Number(row.judgeOutputTokens),
			judgeCacheTokens: Number(row.judgeCacheTokens),
			judgeCostUsdMicros: Number(row.judgeCostUsdMicros),
			judgeCallCount: Number(row.judgeCallCount),
			averageProcessingDurationMs: Number(row.averageProcessingDurationMs),
		}));
	}

	findReviewRunDetail(reviewRunId: string): ReviewRunDetail | null {
		const run = this.connection.db
			.select({
				id: reviewRuns.id,
				repositoryFullName: REPOSITORY_FULL_NAME,
				pullRequestNumber: reviewRuns.pullRequestNumber,
				headSha: reviewRuns.headSha,
				trigger: reviewRuns.trigger,
				status: reviewRuns.status,
				modelName: reviewRuns.modelName,
				createdAt: reviewRuns.createdAt,
				completedAt: reviewRuns.completedAt,
				inputTokens: reviewRuns.inputTokens,
				outputTokens: reviewRuns.outputTokens,
				cacheTokens: reviewRuns.cacheTokens,
				costUsdMicros: reviewRuns.costUsdMicros,
				judgeInputTokens: reviewRuns.judgeInputTokens,
				judgeOutputTokens: reviewRuns.judgeOutputTokens,
				judgeCacheTokens: reviewRuns.judgeCacheTokens,
				judgeCostUsdMicros: reviewRuns.judgeCostUsdMicros,
				reviewStrategyVersion: reviewRuns.reviewStrategyVersion,
				changedLineCount: reviewRuns.changedLineCount,
				reviewChunkCount: reviewRuns.reviewChunkCount,
				judgeCallCount: reviewRuns.judgeCallCount,
				processingDurationMs: reviewRuns.processingDurationMs,
				policySource: reviewRuns.policySource,
				policyWarningCode: reviewRuns.policyWarningCode,
				ignoreReason: reviewRuns.ignoreReason,
				errorCode: reviewRuns.errorCode,
				reviewReportStatus: reviewReports.status,
				githubCommentUrl: reviewReports.githubCommentUrl,
			})
			.from(reviewRuns)
			.innerJoin(
				repositories,
				eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId),
			)
			.leftJoin(reviewReports, eq(reviewReports.reviewRunId, reviewRuns.id))
			.where(eq(reviewRuns.id, reviewRunId))
			.get();

		if (run === undefined) {
			return null;
		}

		const runFindings = this.connection.db
			.select({
				id: findings.id,
				severity: findings.severity,
				path: findings.path,
				line: findings.line,
				title: findings.title,
				rationale: findings.rationale,
				judgeVerdict: findings.judgeVerdict,
				judgeSeverity: findings.judgeSeverity,
				judgeRationale: findings.judgeRationale,
				includedInReport: findings.includedInReport,
			})
			.from(findings)
			.where(eq(findings.reviewRunId, reviewRunId))
			.orderBy(findings.severity, findings.path, findings.line)
			.all();

		return {
			...toReviewRunSummary({
				...run,
				findingCount: runFindings.filter((finding) => finding.includedInReport).length,
			}),
			policySource: run.policySource,
			policyWarningCode: run.policyWarningCode,
			ignoreReason: run.ignoreReason,
			errorCode: run.errorCode,
			findings: runFindings,
		};
	}
}

interface StoredReviewUsage {
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly cacheTokens: number | null;
	readonly costUsdMicros: number | null;
}

interface ReviewRunSummaryRow extends StoredReviewUsage {
	readonly id: string;
	readonly repositoryFullName: string;
	readonly pullRequestNumber: number;
	readonly headSha: string;
	readonly trigger: ReviewRunSummary["trigger"];
	readonly status: ReviewRunSummary["status"];
	readonly modelName: string | null;
	readonly findingCount: number;
	readonly createdAt: string;
	readonly completedAt: string | null;
	readonly judgeInputTokens: number | null;
	readonly judgeOutputTokens: number | null;
	readonly judgeCacheTokens: number | null;
	readonly judgeCostUsdMicros: number | null;
	readonly reviewStrategyVersion: string | null;
	readonly changedLineCount: number | null;
	readonly reviewChunkCount: number | null;
	readonly judgeCallCount: number | null;
	readonly processingDurationMs: number | null;
	readonly reviewReportStatus: ReviewRunSummary["reviewReportStatus"];
	readonly githubCommentUrl: string | null;
}

function toReviewRunSummary(row: ReviewRunSummaryRow): ReviewRunSummary {
	return {
		id: row.id,
		repositoryFullName: row.repositoryFullName,
		pullRequestNumber: row.pullRequestNumber,
		headSha: row.headSha,
		trigger: row.trigger,
		status: row.status,
		modelName: row.modelName,
		findingCount: Number(row.findingCount),
		createdAt: row.createdAt,
		completedAt: row.completedAt,
		usage: readReviewUsage(row),
		judgeUsage: readReviewUsage({
			inputTokens: row.judgeInputTokens,
			outputTokens: row.judgeOutputTokens,
			cacheTokens: row.judgeCacheTokens,
			costUsdMicros: row.judgeCostUsdMicros,
		}),
		reviewStrategyVersion: row.reviewStrategyVersion,
		changedLineCount: row.changedLineCount,
		reviewChunkCount: row.reviewChunkCount,
		judgeCallCount: row.judgeCallCount,
		processingDurationMs: row.processingDurationMs,
		reviewReportStatus: row.reviewReportStatus,
		githubCommentUrl: row.githubCommentUrl,
	};
}

function readReviewUsage(usage: StoredReviewUsage): ReviewRunSummary["usage"] {
	if (
		usage.inputTokens === null ||
		usage.outputTokens === null ||
		usage.cacheTokens === null ||
		usage.costUsdMicros === null
	) {
		return null;
	}
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cacheTokens: usage.cacheTokens,
		costUsdMicros: usage.costUsdMicros,
	};
}
