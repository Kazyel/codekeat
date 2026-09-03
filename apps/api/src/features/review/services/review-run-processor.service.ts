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
import type { ReviewFinding, ReviewWorkQueue } from "../types/review-run.types.js";

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
		this.logger.info({ modelName: this.model.name, reviewRunId }, "review_run.started");

		const inputResult = await this.loadInput(run);
		if (inputResult.kind === "ignored") {
			this.repository.ignoreReviewRun(reviewRunId, inputResult.ignoreReason);
			this.logger.info(
				{
					durationMs: elapsedMilliseconds(startedAt),
					modelName: this.model.name,
					reason: inputResult.ignoreReason,
					reviewRunId,
				},
				"review_run.ignored",
			);
			return;
		}

		if (inputResult.kind === "failed") {
			this.fail(reviewRunId, inputResult.errorCode, startedAt);
			return;
		}

		const reviewResult = await this.review(inputResult.input);
		if (reviewResult.kind === "failed") {
			this.fail(reviewRunId, reviewResult.errorCode, startedAt);
			return;
		}

		const storedFindings = toStoredFindings(reviewResult.findings);
		const reviewReportId = this.repository.completeReviewRun(
			reviewRunId,
			this.model.name,
			storedFindings,
			randomUUID(),
		);

		await this.queue.enqueueReport(reviewReportId);
		this.logger.info(
			{
				chunkCount: inputResult.input.chunks.length,
				durationMs: elapsedMilliseconds(startedAt),
				findingCount: storedFindings.length,
				modelName: this.model.name,
				reviewRunId,
			},
			"review_run.completed",
		);
	}

	private async review(input: ReviewInput): Promise<ReviewResult> {
		const findings: ReviewFinding[] = [];

		for (const chunk of input.chunks) {
			const result = await this.reviewChunk(input, chunk);
			if (result.kind === "failed") {
				return result;
			}

			findings.push(...result.findings);
		}

		return { kind: "completed", findings };
	}

	private async loadInput(run: RunnableReviewRun): Promise<ReviewInputLoadResult> {
		try {
			return await this.inputSource.load(run);
		} catch {
			return { kind: "failed" as const, errorCode: "github_diff_unavailable" as const };
		}
	}

	private async reviewChunk(
		input: ReviewInput,
		chunk: ReviewInput["chunks"][number],
	): Promise<ReviewResult> {
		try {
			const findings = await this.model.review(input, chunk);
			if (!findings.every((finding) => isValidFinding(finding, chunk))) {
				return { kind: "failed", errorCode: "finding_location_invalid" };
			}

			return { kind: "completed", findings };
		} catch (error) {
			if (error instanceof ReviewModelResponseError) {
				return { kind: "failed", errorCode: "gemini_invalid_response" };
			}

			return { kind: "failed", errorCode: "gemini_request_failed" };
		}
	}

	private fail(reviewRunId: string, errorCode: ReviewRunErrorCode, startedAt: number): void {
		this.repository.failReviewRun(reviewRunId, errorCode);
		this.logger.warn(
			{
				durationMs: elapsedMilliseconds(startedAt),
				errorCode,
				modelName: this.model.name,
				reviewRunId,
			},
			"review_run.failed",
		);
	}
}

type ReviewResult =
	| { readonly kind: "completed"; readonly findings: readonly ReviewFinding[] }
	| { readonly kind: "failed"; readonly errorCode: ReviewRunErrorCode };

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
