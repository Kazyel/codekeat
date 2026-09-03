import type { ReviewRunErrorCode, RunnableReviewRun } from "./review-repository.types.js";
import type { ReviewFinding } from "./review-run.types.js";

export interface ReviewInputChunk {
	readonly changedLines: ReadonlyMap<string, ReadonlySet<number>>;
	readonly diff: string;
	readonly index: number;
	readonly total: number;
}

export interface ReviewInput {
	readonly body: string | null;
	readonly chunks: readonly ReviewInputChunk[];
	readonly headSha: string;
	readonly pullRequestNumber: number;
	readonly repositoryFullName: string;
	readonly reviewRunId: string;
	readonly title: string;
}

export type ReviewInputLoadResult =
	| { readonly kind: "failed"; readonly errorCode: ReviewRunErrorCode }
	| { readonly kind: "ignored"; readonly ignoreReason: "superseded_head_sha" }
	| { readonly kind: "ready"; readonly input: ReviewInput };

export interface ReviewInputSource {
	load(run: RunnableReviewRun): Promise<ReviewInputLoadResult>;
}

export interface ReviewModel {
	readonly name: string;
	review(input: ReviewInput, chunk: ReviewInputChunk): Promise<readonly ReviewFinding[]>;
}
