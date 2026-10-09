import { z } from "zod";
import { reviewConclusionSchema } from "#features/review";

/** Provider structure; snapshot, reportable locations and correspondence are checked by the host. */
export const reviewResponseSchema = z
	.object({
		conclusion: reviewConclusionSchema.describe(
			"Record examined scenarios and delivered evidence. Each candidate hypothesis requires a finding at exactly the same path and line in this response; refuted and unresolved hypotheses do not produce findings.",
		),
		findings: z
			.array(
				z
					.object({
						severity: z.enum(["critical", "high", "medium", "low"]),
						path: z.string().trim().min(1),
						line: z.number().int().positive(),
						title: z.string().trim().min(1),
						rationale: z.string().trim().min(1),
					})
					.strict(),
			)
			.describe(
				"Include every supported candidate recorded in conclusion at exactly its path and line. Every finding requires a corresponding candidate hypothesis. An empty array is valid only when conclusion contains no candidate hypotheses.",
			),
	})
	.strict();

export type ReviewResponse = z.infer<typeof reviewResponseSchema>;
