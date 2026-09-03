import {
	type DatabaseConnection,
	findings,
	repositories,
	reviewReports,
	reviewRuns,
} from "@codekeat/database";
import { count, desc, eq, sql } from "drizzle-orm";

import type { ReviewRunDetail, ReviewRunSummary } from "../types/review-repository.types.js";

const REVIEW_RUN_LIST_LIMIT = 50;

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

		return rows.map((row) => ({ ...row, findingCount: Number(row.findingCount) }));
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

		return { ...run, findingCount: runFindings.length, findings: runFindings };
	}
}
