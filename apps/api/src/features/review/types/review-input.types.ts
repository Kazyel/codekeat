import type { ReviewModelConfiguration } from "../../models/index.js";
import type { ReviewRunErrorCode, RunnableReviewRun } from "./review-repository.types.js";
import type { ReviewFinding, ReviewRunIgnoreReason } from "./review-run.types.js";

export type ReviewContextFile =
	| { readonly kind: "loaded"; readonly path: string; readonly content: string }
	| { readonly kind: "truncated"; readonly path: string; readonly content: string }
	| { readonly kind: "missing"; readonly path: string }
	| {
			readonly kind: "unavailable";
			readonly path: string;
			readonly reason: "request_failed" | "invalid_response" | "head_repository_unavailable";
	  };

export interface ReviewRepositoryContext {
	readonly repositoryFullName: string | null;
	readonly revision: string;
	readonly files: readonly ReviewContextFile[];
	readonly omittedFileCount: number;
}

export interface ReviewInputChunk {
	readonly changedLines: ReadonlyMap<string, ReadonlySet<number>>;
	readonly diff: string;
	readonly referenceAfter: string;
	readonly referenceBefore: string;
	readonly index: number;
	readonly total: number;
}

export interface ReviewInput {
	readonly baseSha: string;
	readonly body: string | null;
	readonly chunks: readonly ReviewInputChunk[];
	readonly headSha: string;
	readonly githubInstallationAccountLogin: string;
	readonly pullRequestNumber: number;
	readonly repositoryFullName: string;
	readonly reviewRunId: string;
	readonly repositoryContext: ReviewRepositoryContext;
	readonly title: string;
}
export interface ReviewTokenUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheTokens: number;
	readonly costUsdMicros: number;
}

export interface ReviewModelResult {
	readonly findings: readonly ReviewFinding[];
	readonly usage: ReviewTokenUsage;
}
export type FindingJudgment =
	| { readonly kind: "approved"; readonly rationale: string }
	| { readonly kind: "rejected"; readonly rationale: string }
	| {
			readonly kind: "severity_changed";
			readonly severity: ReviewFinding["severity"];
			readonly rationale: string;
	  };

export interface ReviewFindingEvidence {
	readonly id: string;
	readonly diff: string;
	readonly referenceBefore: string;
	readonly referenceAfter: string;
}

export interface ReviewFindingCandidate {
	readonly evidenceId: string;
	readonly finding: ReviewFinding;
	readonly index: number;
}

export interface ReviewFindingJudgeInput {
	readonly candidates: readonly ReviewFindingCandidate[];
	readonly evidence: readonly ReviewFindingEvidence[];
}

export interface ReviewFindingJudgment {
	readonly index: number;
	readonly judgment: FindingJudgment;
}

export interface ReviewFindingJudgmentResult {
	readonly judgments: readonly ReviewFindingJudgment[];
	readonly usage: ReviewTokenUsage;
}

export interface ReviewFindingJudge {
	judge(
		model: ReviewModelConfiguration,
		input: ReviewInput,
		batch: ReviewFindingJudgeInput,
	): Promise<ReviewFindingJudgmentResult>;
}

export type ReviewInputLoadResult =
	| { readonly kind: "failed"; readonly errorCode: ReviewRunErrorCode }
	| { readonly kind: "ignored"; readonly ignoreReason: ReviewRunIgnoreReason }
	| { readonly kind: "ready"; readonly input: ReviewInput };

export interface ReviewInputSource {
	load(run: RunnableReviewRun): Promise<ReviewInputLoadResult>;
}

export interface ReviewModel {
	review(
		model: ReviewModelConfiguration,
		input: ReviewInput,
		chunk: ReviewInputChunk,
	): Promise<ReviewModelResult>;
}
