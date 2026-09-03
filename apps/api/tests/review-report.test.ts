import { findings, reviewReports } from "@codekeat/database";
import { eq } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";

import {
	formatReviewReport,
	type ReviewReportPublisherClient,
	ReviewReportPublisherService,
} from "#features/review";
import { createTestDatabase } from "./test-database.js";

const REVIEW_RUN_ID = "review-run-1";

describe("ReviewReportPublisherService", () => {
	it("publishes a positive report when a completed run has no findings", async () => {
		const database = createCompletedReview([]);
		const client = new RecordedPublisher();
		const report = database.connection.db.select().from(reviewReports).get();
		if (report === undefined) {
			throw new Error("Review report is missing.");
		}

		await new ReviewReportPublisherService(
			database.reviewReportRepository,
			client,
			pino({ enabled: false }),
		).publish(report.id);

		expect(client.reports).toHaveLength(1);
		const body = formatReviewReport(client.reports[0] ?? fail());
		expect(body).toContain(
			"**Escopo:** diff completo do PR no snapshot do HEAD `aaaaaaa` — não apenas esse commit.",
		);
		expect(body).toContain(
			"Não encontramos problemas concretos no diff completo deste PR nesse snapshot.",
		);
		expect(database.connection.db.select().from(reviewReports).get()?.status).toBe("published");
		database.close();
	});

	it("retries a failed report without creating a duplicate", async () => {
		const database = createCompletedReview([FINDING]);
		const report = database.connection.db.select().from(reviewReports).get();
		if (report === undefined) {
			throw new Error("Review report is missing.");
		}
		database.reviewReportRepository.completeReviewReport(report.id, {
			githubCommentId: 55,
			githubCommentUrl: "https://github.com/takeat/codekeat/pull/30#issuecomment-55",
		});
		database.reviewReportRepository.failReviewReport(report.id, "github_comment_unavailable");
		database.reviewReportRepository.prepareReviewReport(REVIEW_RUN_ID, "report-2");
		const client = new FailingPublisher();

		await new ReviewReportPublisherService(
			database.reviewReportRepository,
			client,
			pino({ enabled: false }),
		).publish(report.id);

		expect(database.connection.db.select().from(reviewReports).get()).toMatchObject({
			status: "failed",
			errorCode: "github_comment_unavailable",
		});
		expect(database.connection.db.select().from(reviewReports).all()).toHaveLength(1);
		database.close();
	});

	it("excludes rejected findings and publishes corrected severity", () => {
		const database = createCompletedReview([
			FINDING,
			{ ...FINDING, title: "Corrected severity" },
		]);
		database.connection.db
			.update(findings)
			.set({
				judgeVerdict: "rejected",
				judgeRationale: "Speculative.",
				includedInReport: false,
			})
			.where(eq(findings.title, FINDING.title))
			.run();
		database.connection.db
			.update(findings)
			.set({
				judgeVerdict: "severity_changed",
				judgeSeverity: "medium",
				judgeRationale: "Localized impact.",
			})
			.where(eq(findings.title, "Corrected severity"))
			.run();

		const report = database.reviewReportRepository.claimReviewReport("report-1");

		expect(report?.findings).toMatchObject([
			{ title: "Corrected severity", severity: "medium" },
		]);
		database.close();
	});

	it("creates a distinct report for every run of the same pull request", () => {
		const database = createCompletedReview([]);
		database.reviewRunRepository.createReviewRun({
			id: "review-run-2",
			githubRepositoryId: 20,
			pullRequestNumber: 30,
			headSha: "b".repeat(40),
			trigger: "synchronize",
			status: "queued",
			policyJson: '{"enabled":true,"version":1}',
			policySource: "default",
			policyWarningCode: null,
			ignoreReason: null,
			model: database.selectedModel,
		});
		database.reviewRunRepository.completeReviewRun("review-run-2", {
			reviewUsage: { inputTokens: 1, outputTokens: 1, cacheTokens: 0, costUsdMicros: 1 },
			judgeUsage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsdMicros: 0 },
			findings: [],
			reviewReportId: "report-2",
			reviewStrategyVersion: "compact-judge-v3",
			changedLineCount: 1,
			reviewChunkCount: 1,
			judgeCallCount: 0,
			processingDurationMs: 1,
		});

		expect(
			database.connection.db
				.select({ id: reviewReports.id, reviewRunId: reviewReports.reviewRunId })
				.from(reviewReports)
				.all(),
		).toEqual([
			{ id: "report-1", reviewRunId: REVIEW_RUN_ID },
			{ id: "report-2", reviewRunId: "review-run-2" },
		]);
		database.close();
	});
});

describe("formatReviewReport", () => {
	it("groups findings and escapes model-controlled Markdown and mentions", () => {
		const report = createReport([FINDING]);
		const body = formatReviewReport(report);

		expect(body).toContain(
			"**Escopo:** diff completo do PR no snapshot do HEAD `aaaaaaa` — não apenas esse commit.",
		);
		expect(body).toContain("Encontramos observações concretas no diff completo deste PR:");
		expect(body).toContain("### High (1)");
		expect(body).toContain("src/example.ts:2");
		expect(body).toContain("@​team");
		expect(body).toContain("\\*unsafe\\*");
	});
});

class RecordedPublisher implements ReviewReportPublisherClient {
	readonly reports: Parameters<ReviewReportPublisherClient["publish"]>[0][] = [];

	async publish(
		report: Parameters<ReviewReportPublisherClient["publish"]>[0],
	): Promise<{ readonly githubCommentId: number; readonly githubCommentUrl: string }> {
		this.reports.push(report);
		return {
			githubCommentId: 99,
			githubCommentUrl: "https://github.com/takeat/codekeat/pull/30#issuecomment-99",
		};
	}
}

class FailingPublisher implements ReviewReportPublisherClient {
	async publish(): Promise<never> {
		throw new Error("GitHub is unavailable.");
	}
}

function createCompletedReview(reviewFindings: readonly (typeof FINDING)[]) {
	const database = createTestDatabase();
	database.githubAccessRepository.upsertInstallation({
		githubInstallationId: 10,
		accountLogin: "takeat",
		status: "active",
	});
	database.githubAccessRepository.upsertRepository({
		githubRepositoryId: 20,
		installationId: 10,
		ownerLogin: "takeat",
		name: "codekeat",
		defaultBranch: "main",
		status: "active",
	});
	database.reviewRunRepository.createReviewRun({
		id: REVIEW_RUN_ID,
		githubRepositoryId: 20,
		pullRequestNumber: 30,
		headSha: "a".repeat(40),
		trigger: "opened",
		status: "queued",
		policyJson: '{"enabled":true,"version":1}',
		policySource: "default",
		policyWarningCode: null,
		ignoreReason: null,
		model: database.selectedModel,
	});
	database.reviewRunRepository.completeReviewRun(REVIEW_RUN_ID, {
		reviewUsage: { inputTokens: 1, outputTokens: 1, cacheTokens: 0, costUsdMicros: 1 },
		judgeUsage: { inputTokens: 1, outputTokens: 1, cacheTokens: 0, costUsdMicros: 1 },
		findings: reviewFindings.map((currentFinding, index) => ({
			...currentFinding,
			id: `finding-${index}`,
			judgeVerdict: "approved",
			judgeSeverity: null,
			judgeRationale: "Confirmed.",
			includedInReport: true,
		})),
		reviewReportId: "report-1",
		reviewStrategyVersion: "judge-gate-v1",
		changedLineCount: 1,
		reviewChunkCount: 1,
		judgeCallCount: reviewFindings.length === 0 ? 0 : 1,
		processingDurationMs: 100,
	});
	return database;
}

function createReport(reviewFindings: readonly (typeof FINDING)[]) {
	const database = createCompletedReview(reviewFindings);
	const report = database.reviewReportRepository.claimReviewReport("report-1");
	database.close();
	if (report === null) {
		throw new Error("Publishable review report is missing.");
	}
	return report;
}

function fail(): never {
	throw new Error("Expected report is missing.");
}

const FINDING = {
	severity: "high" as const,
	path: "src/example.ts",
	line: 2,
	title: "*unsafe* @team",
	rationale: "A concrete rationale.",
};
