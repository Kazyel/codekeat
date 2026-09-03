import {
	findings,
	repositories,
	reviewReports,
	reviewRuns,
	type DatabaseConnection,
} from "@codekeat/database";
import { and, eq, sql } from "drizzle-orm";
import { currentTimestamp } from "#shared/database";

import type {
	PublishableReviewReport,
	ReviewReportComment,
	ReviewReportErrorCode,
	StoredFinding,
} from "../types/review-repository.types.js";

interface ReviewRunReference {
	readonly githubRepositoryId: number;
	readonly pullRequestNumber: number;
}

type ReviewReportDatabase = Pick<DatabaseConnection["db"], "insert" | "select">;

export class ReviewReportRepository {
	constructor(private readonly connection: DatabaseConnection) {}

	prepareReviewReport(reviewRunId: string, reviewReportId: string): string | null {
		const now = currentTimestamp();
		const run = this.connection.db
			.select({
				githubRepositoryId: reviewRuns.githubRepositoryId,
				pullRequestNumber: reviewRuns.pullRequestNumber,
			})
			.from(reviewRuns)
			.where(and(eq(reviewRuns.id, reviewRunId), eq(reviewRuns.status, "completed")))
			.get();

		if (run === undefined || this.isReviewRunPublished(reviewRunId)) {
			return null;
		}

		return this.savePendingReport(this.connection.db, run, reviewRunId, reviewReportId, now);
	}

	claimReviewReport(reviewReportId: string): PublishableReviewReport | null {
		const claim = this.connection.db
			.update(reviewReports)
			.set({ status: "publishing", updatedAt: currentTimestamp() })
			.where(
				and(
					eq(reviewReports.id, reviewReportId),
					sql`${reviewReports.status} IN ('pending', 'failed')`,
				),
			)
			.run();

		if (claim.changes === 0) {
			return null;
		}

		const report = this.connection.db
			.select({
				reportId: reviewReports.id,
				reviewRunId: reviewReports.reviewRunId,
				githubInstallationId: repositories.installationId,
				repositoryOwner: repositories.ownerLogin,
				repositoryName: repositories.name,
				repositoryFullName: sql<string>`${repositories.ownerLogin} || '/' || ${repositories.name}`,
				pullRequestNumber: reviewReports.pullRequestNumber,
				headSha: reviewRuns.headSha,
			})
			.from(reviewReports)
			.innerJoin(reviewRuns, eq(reviewReports.reviewRunId, reviewRuns.id))
			.innerJoin(
				repositories,
				eq(reviewReports.githubRepositoryId, repositories.githubRepositoryId),
			)
			.where(eq(reviewReports.id, reviewReportId))
			.get();

		if (report === undefined) {
			throw new Error("Claimed review report is missing its review run.");
		}

		return { ...report, findings: this.findFindings(report.reviewRunId) };
	}

	completeReviewReport(reviewReportId: string, comment: ReviewReportComment): void {
		const now = currentTimestamp();
		this.connection.db
			.update(reviewReports)
			.set({
				status: "published",
				githubCommentId: comment.githubCommentId,
				githubCommentUrl: comment.githubCommentUrl,
				errorCode: null,
				publishedAt: now,
				updatedAt: now,
			})
			.where(eq(reviewReports.id, reviewReportId))
			.run();
	}

	failReviewReport(reviewReportId: string, errorCode: ReviewReportErrorCode): void {
		this.connection.db
			.update(reviewReports)
			.set({ status: "failed", errorCode, updatedAt: currentTimestamp() })
			.where(eq(reviewReports.id, reviewReportId))
			.run();
	}

	savePendingReport(
		database: ReviewReportDatabase,
		run: ReviewRunReference,
		reviewRunId: string,
		reviewReportId: string,
		now: string,
	): string {
		database
			.insert(reviewReports)
			.values({
				id: reviewReportId,
				githubRepositoryId: run.githubRepositoryId,
				pullRequestNumber: run.pullRequestNumber,
				reviewRunId,
				githubCommentId: null,
				githubCommentUrl: null,
				status: "pending",
				errorCode: null,
				createdAt: now,
				updatedAt: now,
				publishedAt: null,
			})
			.onConflictDoUpdate({
				target: reviewReports.reviewRunId,
				set: {
					githubCommentId: null,
					githubCommentUrl: null,
					status: "pending",
					errorCode: null,
					updatedAt: now,
					publishedAt: null,
				},
			})
			.run();

		const report = database
			.select({ id: reviewReports.id })
			.from(reviewReports)
			.where(eq(reviewReports.reviewRunId, reviewRunId))
			.get();

		if (report === undefined) {
			throw new Error("Completed review run is missing its report.");
		}

		return report.id;
	}

	private isReviewRunPublished(reviewRunId: string): boolean {
		const report = this.connection.db
			.select({ status: reviewReports.status })
			.from(reviewReports)
			.where(eq(reviewReports.reviewRunId, reviewRunId))
			.get();

		return report?.status === "published";
	}

	private findFindings(reviewRunId: string): readonly StoredFinding[] {
		return this.connection.db
			.select({
				id: findings.id,
				severity: sql<
					StoredFinding["severity"]
				>`coalesce(${findings.judgeSeverity}, ${findings.severity})`,
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
			.where(and(eq(findings.reviewRunId, reviewRunId), eq(findings.includedInReport, true)))
			.all();
	}
}
