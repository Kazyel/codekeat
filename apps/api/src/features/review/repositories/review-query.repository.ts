import {
	type DatabaseConnection,
	findings,
	repositories,
	reviewReports,
	reviewRuns,
} from "@codekeat/database";
import { and, asc, count, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";

import type {
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
		const rows = this.connection.db
			.select({
				id: reviewRuns.id,
				repositoryFullName: sql<string>`${repositories.ownerLogin} || '/' || ${repositories.name}`,
				pullRequestNumber: reviewRuns.pullRequestNumber,
				headSha: reviewRuns.headSha,
				trigger: reviewRuns.trigger,
				status: reviewRuns.status,
				modelName: reviewRuns.modelName,
				findingCount: count(findings.id),
				createdAt: reviewRuns.createdAt,
				completedAt: reviewRuns.completedAt,
				inputTokens: reviewRuns.inputTokens,
				outputTokens: reviewRuns.outputTokens,
				cacheTokens: reviewRuns.cacheTokens,
				costUsdMicros: reviewRuns.costUsdMicros,
				reviewReportStatus: reviewReports.status,
				githubCommentUrl: reviewReports.githubCommentUrl,
			})
			.from(reviewRuns)
			.innerJoin(
				repositories,
				eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId),
			)
			.leftJoin(findings, eq(findings.reviewRunId, reviewRuns.id))
			.leftJoin(reviewReports, eq(reviewReports.reviewRunId, reviewRuns.id))
			.groupBy(reviewRuns.id)
			.orderBy(desc(reviewRuns.createdAt))
			.limit(REVIEW_RUN_LIST_LIMIT)
			.all();

		return rows.map(({ inputTokens, outputTokens, cacheTokens, costUsdMicros, ...row }) => ({
			...row,
			findingCount: Number(row.findingCount),
			usage: readReviewUsage({ inputTokens, outputTokens, cacheTokens, costUsdMicros }),
		}));
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

	findReviewRunDetail(reviewRunId: string): ReviewRunDetail | null {
		const run = this.connection.db
			.select({
				id: reviewRuns.id,
				repositoryFullName: sql<string>`${repositories.ownerLogin} || '/' || ${repositories.name}`,
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
			})
			.from(findings)
			.where(eq(findings.reviewRunId, reviewRunId))
			.orderBy(findings.severity, findings.path, findings.line)
			.all();

		const { inputTokens, outputTokens, cacheTokens, costUsdMicros, ...reviewRun } = run;
		return {
			...reviewRun,
			findingCount: runFindings.length,
			findings: runFindings,
			usage: readReviewUsage({ inputTokens, outputTokens, cacheTokens, costUsdMicros }),
		};
	}
}

interface StoredReviewUsage {
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly cacheTokens: number | null;
	readonly costUsdMicros: number | null;
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
