import { describe, expect, it } from "vitest";

import { getReviewsPagination, reviewsSearchSchema } from "./reviews-search";

const reviewRunId = "c2f10d56-b5b0-4a2f-a45b-83e84532bd22";

describe("reviews URL state", () => {
	it("drops malformed fields without losing valid list context", () => {
		const search = reviewsSearchSchema.parse({
			reviewRunId: "not-a-review",
			q: "my-org/api #248",
			status: "unknown-status",
			sort: [{ id: "findingCount", desc: true }],
			page: "3",
		});

		expect(search).toEqual({
			reviewRunId: undefined,
			q: "my-org/api #248",
			status: undefined,
			sort: [{ id: "findingCount", desc: true }],
			page: 3,
		});
	});

	it("rejects unsupported sorting and fractional pages without closing a valid review", () => {
		const search = reviewsSearchSchema.parse({
			reviewRunId,
			q: ["unexpected-array"],
			status: "running",
			sort: [{ id: "missing-column", desc: true }],
			page: 1.5,
		});

		expect(search).toEqual({
			reviewRunId,
			q: undefined,
			status: "running",
			sort: undefined,
			page: undefined,
		});
	});

	it("keeps a later page through refreshes, clamping only when it no longer exists", () => {
		expect(getReviewsPagination(3, 50).pageIndex).toBe(2);
		expect(getReviewsPagination(3, 24).pageIndex).toBe(2);
		expect(getReviewsPagination(3, 20).pageIndex).toBe(1);
		expect(getReviewsPagination(3, 0).pageIndex).toBe(0);
	});
});
