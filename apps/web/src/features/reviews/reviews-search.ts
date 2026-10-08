import type { PaginationState } from "@tanstack/react-table";
import { z } from "zod";

import { reviewRunSummarySchema } from "@/lib/api-contracts";

export const reviewsSearchSchema = z.object({
	reviewRunId: z.uuid().optional().catch(undefined),
	q: z.string().optional().catch(undefined),
	status: z
		.union([z.literal("all"), reviewRunSummarySchema.shape.status])
		.optional()
		.catch(undefined),
	sort: z
		.array(
			z.object({
				id: z.enum([
					"repositoryFullName",
					"pullRequestNumber",
					"status",
					"findingCount",
					"createdAt",
				]),
				desc: z.boolean(),
			}),
		)
		.max(5)
		.optional()
		.catch(undefined),
	page: z
		.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
		.pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
		.optional()
		.catch(undefined),
});

export function getReviewsPagination(page: number | undefined, rowCount: number): PaginationState {
	const pageSize = 10;
	const lastPageIndex = Math.max(0, Math.ceil(rowCount / pageSize) - 1);
	return { pageIndex: Math.min((page ?? 1) - 1, lastPageIndex), pageSize };
}
