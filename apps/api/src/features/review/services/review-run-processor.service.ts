import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { Logger } from "pino";

import { ReviewModelResponseError } from "../errors/review-model.error.js";
import type { ReviewRunRepository } from "../repositories/review-run.repository.js";
import type {
	ReviewInput,
	ReviewInputLoadResult,
	ReviewInputSource,
	ReviewModel,
} from "../types/review-input.types.js";
import type {
	ReviewRunErrorCode,
	RunnableReviewRun,
	StoredFinding,
} from "../types/review-repository.types.js";
import type { ReviewFinding, ReviewResult, ReviewWorkQueue } from "../types/review-run.types.js";

export class ReviewRunProcessorService {
	constructor(
		private readonly repository: ReviewRunRepository,
		private readonly inputSource: ReviewInputSource,
		private readonly model: ReviewModel,
		private readonly queue: Pick<ReviewWorkQueue, "enqueueReport">,
		private readonly logger: Logger,
	) {}

	async process(reviewRunId: string): Promise<void> {
		const run = this.repository.claimQueuedReviewRun(reviewRunId);
		if (run === null) {
			return;
		}

		const startedAt = performance.now();
		this.logger.info({ modelName: run.model.apiName, reviewRunId }, "review_run.started");

		const inputResult = await this.loadInput(run);
		if (inputResult.kind === "ignored") {
			this.repository.ignoreReviewRun(reviewRunId, inputResult.ignoreReason);
			this.logger.info(
				{
					durationMs: elapsedMilliseconds(startedAt),
					modelName: run.model.apiName,
					reason: inputResult.ignoreReason,
					reviewRunId,
				},
				"review_run.ignored",
			);
			return;
		}

		if (inputResult.kind === "failed") {
			this.fail(run, inputResult.errorCode, startedAt);
			return;
		}

		const reviewResult = await this.review(run.model, inputResult.input);
		if (reviewResult.kind === "failed") {
			this.fail(run, reviewResult.errorCode, startedAt);
			return;
		}

		const storedFindings = toStoredFindings(reviewResult.findings);
		const reviewReportId = this.repository.completeReviewRun(
			reviewRunId,
			reviewResult.usage,
			storedFindings,
			randomUUID(),
		);

		await this.queue.enqueueReport(reviewReportId);
		this.logger.info(
			{
				chunkCount: inputResult.input.chunks.length,
				durationMs: elapsedMilliseconds(startedAt),
				findingCount: storedFindings.length,
				modelName: run.model.apiName,
				reviewRunId,
			},
			"review_run.completed",
		);
	}

	private async review(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
	): Promise<ReviewResult> {
		const findings: ReviewFinding[] = [];

		let inputTokens = 0;
		let outputTokens = 0;
		let cacheTokens = 0;
		let costUsdMicros = 0;

		for (const chunk of input.chunks) {
			const result = await this.reviewChunk(model, input, chunk);
			if (result.kind === "failed") {
				return result;
			}

			findings.push(...result.findings);
			inputTokens += result.usage.inputTokens;
			outputTokens += result.usage.outputTokens;
			cacheTokens += result.usage.cacheTokens;
			costUsdMicros += result.usage.costUsdMicros;
		}

		return {
			kind: "completed",
			findings,
			usage: {
				inputTokens,
				outputTokens,
				cacheTokens,
				costUsdMicros: Math.round(costUsdMicros),
			},
		};
	}

	private async loadInput(run: RunnableReviewRun): Promise<ReviewInputLoadResult> {
		try {
			return await this.inputSource.load(run);
		} catch {
			return { kind: "failed" as const, errorCode: "github_diff_unavailable" as const };
		}
	}

	private async reviewChunk(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		chunk: ReviewInput["chunks"][number],
	): Promise<ReviewResult> {
		try {
			const result = await this.model.review(model, input, chunk);
			if (!result.findings.every((finding) => isValidFinding(finding, chunk))) {
				return { kind: "failed", errorCode: "finding_location_invalid" };
			}

			return { kind: "completed", findings: result.findings, usage: result.usage };
		} catch (error) {
			if (error instanceof ReviewModelResponseError) {
				return { kind: "failed", errorCode: "gemini_invalid_response" };
			}

			return { kind: "failed", errorCode: "gemini_request_failed" };
		}
	}

	private fail(run: RunnableReviewRun, errorCode: ReviewRunErrorCode, startedAt: number): void {
		this.repository.failReviewRun(run.id, errorCode);
		this.logger.warn(
			{
				durationMs: elapsedMilliseconds(startedAt),
				errorCode,
				modelName: run.model.apiName,
				reviewRunId: run.id,
			},
			"review_run.failed",
		);
	}
}

function isValidFinding(finding: ReviewFinding, chunk: ReviewInput["chunks"][number]): boolean {
	return (
		hasValidContent(finding) &&
		(chunk.changedLines.get(finding.path)?.has(finding.line) ?? false)
	);
}

function hasValidContent(finding: ReviewFinding): boolean {
	return (
		["critical", "high", "medium", "low"].includes(finding.severity) &&
		finding.path.trim().length > 0 &&
		finding.title.trim().length > 0 &&
		finding.rationale.trim().length > 0
	);
}

function toStoredFindings(findings: readonly ReviewFinding[]): readonly StoredFinding[] {
	const uniqueFindings = new Map<string, ReviewFinding>();
	for (const finding of findings) {
		uniqueFindings.set(findingKey(finding), finding);
	}

	const persistableFindings = new Map<string, ReviewFinding>();
	for (const finding of uniqueFindings.values()) {
		persistableFindings.set(persistenceKey(finding), finding);
	}

	return [...persistableFindings.values()].map((finding) => ({ ...finding, id: randomUUID() }));
}

function findingKey(finding: ReviewFinding): string {
	return `${finding.severity}:${finding.path}:${finding.line}:${finding.title}:${finding.rationale}`;
}

function persistenceKey(finding: ReviewFinding): string {
	return `${finding.path}:${finding.line}:${finding.title}`;
}

function elapsedMilliseconds(startedAt: number): number {
	return Math.round(performance.now() - startedAt);
}
