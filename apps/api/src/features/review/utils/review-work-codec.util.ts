import { z } from "zod";
import type { ReviewInputChunk, ReviewModelResult } from "../types/review-input.types.js";
import type { StoredFinding } from "../types/review-repository.types.js";
import type { ReviewFindingJudgeBatch } from "./review-finding-evidence.util.js";
import { reviewConclusionSchema } from "../types/review-conclusion.types.js";

const count = z.number().int().nonnegative();
const finding = z
	.object({
		severity: z.enum(["critical", "high", "medium", "low"]),
		path: z.string().min(1),
		line: z.number().int().positive(),
		title: z.string().min(1),
		rationale: z.string().min(1),
	})
	.strict();
const investigation = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("verified"),
			context: z.enum(["available", "unavailable", "not_enabled"]),
			exchanges: z.array(
				z
					.object({
						tool: z.string(),
						argumentsJson: z.string(),
						responseJson: z.string(),
					})
					.strict(),
			),
			conclusion: reviewConclusionSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("available"),
			exchanges: z.array(
				z
					.object({
						tool: z.string(),
						argumentsJson: z.string(),
						responseJson: z.string(),
					})
					.strict(),
			),
		})
		.strict(),
	z.object({ kind: z.literal("unavailable") }).strict(),
	z.object({ kind: z.literal("not_enabled") }).strict(),
]);
const chunkSchema = z
	.object({
		changedLines: z.array(z.tuple([z.string(), z.array(z.number().int().positive())])),
		diff: z.string(),
		referenceBefore: z.string(),
		referenceAfter: z.string(),
		index: count,
		total: count,
	})
	.strict();
const usage = z
	.object({
		inputTokens: count,
		outputTokens: count,
		cacheTokens: count,
		costUsdMicros: z.number().nonnegative(),
	})
	.strict()
	.refine((value) => value.cacheTokens <= value.inputTokens);
const resultSchema = z.object({ findings: z.array(finding), investigation, usage }).strict();
const reviewCheckpointSchema = z.object({ chunk: z.string(), result: resultSchema }).strict();

/** Review leaves preserve their exact reportable chunk alongside the validated model result. */
export interface ReviewCheckpoint {
	readonly chunk: ReviewInputChunk;
	readonly result: ReviewModelResult;
}
const batchSchema = z
	.object({
		findings: z.array(finding),
		input: z
			.object({
				candidates: z.array(
					z.object({ index: count, evidenceId: z.string(), finding }).strict(),
				),
				evidence: z.array(
					z
						.object({
							id: z.string(),
							diff: z.string(),
							referenceBefore: z.string(),
							referenceAfter: z.string(),
							investigation,
						})
						.strict(),
				),
			})
			.strict(),
	})
	.strict();
const storedFindings = z.array(
	finding
		.extend({
			id: z.string(),
			judgeVerdict: z.enum(["approved", "rejected", "severity_changed"]),
			judgeSeverity: z.enum(["critical", "high", "medium", "low"]).nullable(),
			judgeRationale: z.string().min(1),
			includedInReport: z.boolean(),
		})
		.strict(),
);

export function encodeReviewChunk(chunk: ReviewInputChunk): string {
	return JSON.stringify({
		...chunk,
		changedLines: [...chunk.changedLines].map(([path, lines]) => [path, [...lines]]),
	});
}
export function decodeReviewChunk(json: string): ReviewInputChunk {
	const parsed = chunkSchema.parse(JSON.parse(json));
	return {
		...parsed,
		changedLines: new Map(parsed.changedLines.map(([path, lines]) => [path, new Set(lines)])),
	};
}
export function encodeReviewCheckpoint(checkpoint: ReviewCheckpoint): string {
	return JSON.stringify(
		reviewCheckpointSchema.parse({
			chunk: encodeReviewChunk(checkpoint.chunk),
			result: checkpoint.result,
		}),
	);
}
export function decodeReviewCheckpoint(json: string): ReviewCheckpoint {
	const checkpoint = reviewCheckpointSchema.parse(JSON.parse(json));
	return { chunk: decodeReviewChunk(checkpoint.chunk), result: checkpoint.result };
}
export function decodeJudgeBatch(json: string): ReviewFindingJudgeBatch {
	return batchSchema.parse(JSON.parse(json));
}
export function decodeStoredFindings(json: string): readonly StoredFinding[] {
	return storedFindings.parse(JSON.parse(json));
}
