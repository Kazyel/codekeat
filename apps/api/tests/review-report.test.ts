import { findings, reviewReports, reviewWorkUnits } from "@codekeat/database";
import { eq } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";

import {
	formatReviewReport,
	type ReviewReportPublisherClient,
	ReviewReportPublisherService,
	type ReviewModelResult,
} from "#features/review";
import { createTestDatabase, type TestDatabase } from "./test-database.js";
import type { ReviewConclusion } from "../src/features/review/types/review-conclusion.types.js";

const REVIEW_RUN_ID = "review-run-1";

describe("ReviewReportPublisherService", () => {
	it("publishes historical no-findings reports without claiming a recorded investigation", async () => {
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
			"Nenhum finding publicado; investigação detalhada não registrada nesta execução.",
		);
		expect(database.connection.db.select().from(reviewReports).get()?.status).toBe("published");
		database.close();
	});

	it.each(["complete", "incomplete"] as const)(
		"publishes counts from %s investigation leaves without exposing private evidence",
		(status) => {
			const database = createCompletedReview([]);
			persistCheckpoint(database, "leaf-1", reviewResult(conclusion("complete")));
			persistCheckpoint(database, "leaf-2", reviewResult(conclusion(status)));
			persistCheckpoint(database, "split-parent", "invalid parent result", "split");
			persistCheckpoint(database, "judge", "invalid judge result", "completed", "judge");
			const report = database.reviewReportRepository.claimReviewReport("report-1");
			if (report === null) fail();
			const body = formatReviewReport(report);

			expect(report.investigation).toMatchObject({
				status,
				unitCount: 2,
				recordedUnitCount: 2,
				reviewedPathCount: 1,
				scenarioCount: 2,
				refutedScenarioCount: status === "complete" ? 2 : 1,
				unresolvedScenarioCount: status === "complete" ? 0 : 1,
				gapCount: status === "complete" ? 0 : 1,
			});
			expect(body).toContain("2/2 unidades, 1 arquivos e 2 cenários examinados");
			expect(body).not.toContain("private evidence");
			expect(body).not.toContain("Não encontramos problemas concretos");
			expect(body.includes("A investigação está incompleta")).toBe(status === "incomplete");
			database.close();
		},
	);

	it("retains incomplete coverage alongside published findings and historical checkpoints", () => {
		const database = createCompletedReview([FINDING]);
		persistCheckpoint(database, "new", reviewResult(conclusion("complete")));
		persistCheckpoint(database, "historical", {
			...reviewResult(conclusion("complete")),
			investigation: { kind: "not_enabled" },
		});
		const report = database.reviewReportRepository.claimReviewReport("report-1");
		if (report === null) fail();
		expect(report.investigation).toMatchObject({
			status: "incomplete",
			recordedUnitCount: 1,
			unitCount: 2,
		});
		const body = formatReviewReport(report);
		expect(body).toContain("Encontramos observações concretas");
		expect(body).toContain("Investigação incompleta");
		database.close();
	});

	it.each(["invalid", "missing", "unfinished"] as const)(
		"refuses a report with a %s checkpoint and preserves its pending claim",
		(kind) => {
			const database = createCompletedReview([]);
			persistCheckpoint(
				database,
				"leaf",
				kind === "invalid" ? "not JSON" : null,
				kind === "unfinished" ? "pending" : "completed",
			);
			expect(() => database.reviewReportRepository.claimReviewReport("report-1")).toThrow(
				/JSON|checkpoint/,
			);
			expect(database.connection.db.select().from(reviewReports).get()?.status).toBe(
				"pending",
			);
			database.close();
		},
	);

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
			githubCommentId: 55,
			githubCommentUrl: "https://github.com/takeat/codekeat/pull/30#issuecomment-55",
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

function conclusion(status: ReviewConclusion["status"]): ReviewConclusion {
	const hypothesis = {
		path: "private evidence/path.ts",
		line: 1,
		scenario: "private evidence scenario",
		expectedBehavior: "private evidence expected behavior",
		observedBehavior: "private evidence observed behavior",
	};
	if (status === "incomplete")
		return {
			status,
			reviewedPaths: [hypothesis.path],
			hypotheses: [
				{
					...hypothesis,
					outcome: "unresolved",
					evidence: [],
					missingEvidence: ["private evidence missing"],
				},
			],
			gaps: ["private evidence gap"],
		};
	return {
		status,
		reviewedPaths: [hypothesis.path],
		hypotheses: [
			{
				...hypothesis,
				outcome: "refuted",
				evidence: [
					{
						path: hypothesis.path,
						role: "head",
						revision: "a".repeat(40),
						startLine: 1,
						endLine: 2,
					},
				],
				missingEvidence: [],
			},
		],
	};
}

function reviewResult(recordedConclusion: ReviewConclusion): ReviewModelResult {
	return {
		findings: [],
		investigation: {
			kind: "verified",
			context: "not_enabled",
			exchanges: [],
			conclusion: recordedConclusion,
		},
		usage: { inputTokens: 1, outputTokens: 1, cacheTokens: 0, costUsdMicros: 1 },
	};
}

function persistCheckpoint(
	database: TestDatabase,
	id: string,
	result: ReviewModelResult | string | null,
	status: typeof reviewWorkUnits.$inferInsert.status = "completed",
	stage: typeof reviewWorkUnits.$inferInsert.stage = "review",
): void {
	const encodedChunk = JSON.stringify({
		changedLines: [["src/example.ts", [2]]],
		diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1,2 @@\n old\n+new\n",
		referenceBefore: "",
		referenceAfter: "",
		index: 1,
		total: 1,
	});
	database.connection.db
		.insert(reviewWorkUnits)
		.values({
			id,
			reviewRunId: REVIEW_RUN_ID,
			stage,
			parentId: null,
			status,
			ordinal: 0,
			payloadJson: encodedChunk,
			resultJson:
				typeof result === "string" || result === null
					? result
					: JSON.stringify({ chunk: encodedChunk, result }),
			updatedAt: new Date().toISOString(),
		})
		.run();
}

const FINDING = {
	severity: "high" as const,
	path: "src/example.ts",
	line: 2,
	title: "*unsafe* @team",
	rationale: "A concrete rationale.",
};
