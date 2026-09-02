import { findings, repositories, reviewRuns, type DatabaseConnection } from "@codekeat/database";
import { and, eq, sql } from "drizzle-orm";
import { currentTimestamp } from "#shared/database";

import type {
	ExistingReviewRun,
	ReviewRunErrorCode,
	ReviewRunInput,
	RunnableReviewRun,
	StoredFinding,
} from "../types/review-repository.types.js";
import type { ReviewRunIgnoreReason, ReviewTrigger } from "../types/review-run.types.js";
import { ReviewReportRepository } from "./review-report.repository.js";

export class ReviewRunRepository {
	constructor(
		private readonly connection: DatabaseConnection,
		private readonly reportRepository: ReviewReportRepository,
	) {}

	createReviewRun(input: ReviewRunInput): "created" | "duplicate" {
		const now = currentTimestamp();
		const result = this.connection.db
			.insert(reviewRuns)
			.values({
				...input,
				errorCode: null,
				modelName: null,
				createdAt: now,
				startedAt: null,
				completedAt: null,
				updatedAt: now,
			})
			.onConflictDoNothing({
				target: [
					reviewRuns.githubRepositoryId,
					reviewRuns.pullRequestNumber,
					reviewRuns.headSha,
				],
			})
			.run();

		return result.changes === 0 ? "duplicate" : "created";
	}

	findReviewRun(
		githubRepositoryId: number,
		pullRequestNumber: number,
		headSha: string,
	): ExistingReviewRun | null {
		const run = this.connection.db
			.select({ id: reviewRuns.id, status: reviewRuns.status })
			.from(reviewRuns)
			.where(
				and(
					eq(reviewRuns.githubRepositoryId, githubRepositoryId),
					eq(reviewRuns.pullRequestNumber, pullRequestNumber),
					eq(reviewRuns.headSha, headSha),
				),
			)
			.get();

		return run ?? null;
	}

	requeueReviewRun(reviewRunId: string, trigger: ReviewTrigger): boolean {
		const result = this.connection.db
			.update(reviewRuns)
			.set({
				trigger,
				status: "queued",
				errorCode: null,
				ignoreReason: null,
				modelName: null,
				startedAt: null,
				completedAt: null,
				updatedAt: currentTimestamp(),
			})
			.where(
				and(
					eq(reviewRuns.id, reviewRunId),
					sql`${reviewRuns.status} IN ('failed', 'ignored')`,
				),
			)
			.run();

		return result.changes > 0;
	}

	claimQueuedReviewRun(reviewRunId: string): RunnableReviewRun | null {
		const now = currentTimestamp();
		const claim = this.connection.db
			.update(reviewRuns)
			.set({ status: "running", startedAt: now, updatedAt: now })
			.where(and(eq(reviewRuns.id, reviewRunId), eq(reviewRuns.status, "queued")))
			.run();

		if (claim.changes === 0) {
			return null;
		}

		const row = this.connection.db
			.select({
				id: reviewRuns.id,
				githubInstallationId: repositories.installationId,
				repositoryOwner: repositories.ownerLogin,
				repositoryName: repositories.name,
				repositoryFullName: sql<string>`${repositories.ownerLogin} || '/' || ${repositories.name}`,
				pullRequestNumber: reviewRuns.pullRequestNumber,
				headSha: reviewRuns.headSha,
			})
			.from(reviewRuns)
			.innerJoin(
				repositories,
				eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId),
			)
			.where(eq(reviewRuns.id, reviewRunId))
			.get();

		if (row === undefined) {
			throw new Error("Claimed review run is missing its repository.");
		}

		return row;
	}

	completeReviewRun(
		reviewRunId: string,
		modelName: string,
		reviewFindings: readonly StoredFinding[],
		reviewReportId: string,
	): string {
		const now = currentTimestamp();
		return this.connection.db.transaction((transaction) => {
			if (reviewFindings.length > 0) {
				transaction
					.insert(findings)
					.values(
						reviewFindings.map((finding) => ({
							...finding,
							reviewRunId,
							createdAt: now,
						})),
					)
					.run();
			}

			transaction
				.update(reviewRuns)
				.set({
					status: "completed",
					modelName,
					completedAt: now,
					updatedAt: now,
				})
				.where(eq(reviewRuns.id, reviewRunId))
				.run();

			const run = transaction
				.select({
					githubRepositoryId: reviewRuns.githubRepositoryId,
					pullRequestNumber: reviewRuns.pullRequestNumber,
				})
				.from(reviewRuns)
				.where(eq(reviewRuns.id, reviewRunId))
				.get();

			if (run === undefined) {
				throw new Error("Completed review run is missing.");
			}

			return this.reportRepository.savePendingReport(
				transaction,
				run,
				reviewRunId,
				reviewReportId,
				now,
			);
		});
	}

	failReviewRun(reviewRunId: string, errorCode: ReviewRunErrorCode): void {
		const now = currentTimestamp();
		this.connection.db
			.update(reviewRuns)
			.set({ status: "failed", errorCode, completedAt: now, updatedAt: now })
			.where(eq(reviewRuns.id, reviewRunId))
			.run();
	}

	ignoreReviewRun(reviewRunId: string, ignoreReason: ReviewRunIgnoreReason): void {
		const now = currentTimestamp();
		this.connection.db
			.update(reviewRuns)
			.set({ status: "ignored", ignoreReason, completedAt: now, updatedAt: now })
			.where(eq(reviewRuns.id, reviewRunId))
			.run();
	}
}
