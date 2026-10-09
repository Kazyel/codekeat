import { z } from "zod";

const text = z.string().trim().min(1);
const evidence = z
	.object({
		path: text,
		role: z.enum(["head", "before", "pull_request", "investigation"]),
		revision: text,
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.strict()
	.refine((value) => value.endLine >= value.startLine);

const hypothesis = z
	.object({
		path: text,
		line: z.number().int().positive(),
		scenario: text,
		expectedBehavior: text,
		observedBehavior: text,
		outcome: z.enum(["refuted", "candidate", "unresolved"]),
		evidence: z.array(evidence),
		missingEvidence: z.array(text),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.outcome === "unresolved" && value.missingEvidence.length === 0)
			context.addIssue({
				code: "custom",
				message: "Unresolved hypotheses require explicit gaps.",
			});
		if (resolvedHypothesisInvalid(value))
			context.addIssue({
				code: "custom",
				message: "Resolved hypotheses require evidence and no gaps.",
			});
	});

function resolvedHypothesisInvalid(value: {
	readonly outcome: string;
	readonly evidence: readonly z.infer<typeof evidence>[];
	readonly missingEvidence: readonly string[];
}): boolean {
	return (
		value.outcome !== "unresolved" &&
		(value.evidence.length === 0 || value.missingEvidence.length > 0)
	);
}
const common = {
	reviewedPaths: z.array(text).min(1),
	hypotheses: z.array(hypothesis).min(1),
};

/** Records observable scenarios and sources, never private chain-of-thought. */
export const reviewConclusionSchema = z
	.discriminatedUnion("status", [
		z.object({ status: z.literal("complete"), ...common }).strict(),
		z
			.object({ status: z.literal("incomplete"), ...common, gaps: z.array(text).min(1) })
			.strict(),
	])
	.superRefine((value, context) => {
		if (
			value.status === "complete" &&
			value.hypotheses.some((entry) => entry.outcome === "unresolved")
		)
			context.addIssue({
				code: "custom",
				message: "Complete investigations cannot contain unresolved hypotheses.",
			});
	});

export type ReviewConclusion = z.infer<typeof reviewConclusionSchema>;
export type ReviewHypothesis = ReviewConclusion["hypotheses"][number];

export const REVIEW_STRATEGY_VERSION = "evidence-investigation-v9";
