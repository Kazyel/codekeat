import { describe, expect, it } from "vitest";

import { createReviewInputChunks, MAXIMUM_REVIEW_CHUNK_LENGTH } from "#features/github";

describe("createReviewInputChunks", () => {
	it("maps added lines to their file and keeps chunks below the limit", () => {
		const chunks = createReviewInputChunks(SAMPLE_DIFF);

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.changedLines.get("src/example.ts")).toEqual(new Set([2, 3]));
		expect(chunks[0]?.diff.length).toBeLessThanOrEqual(MAXIMUM_REVIEW_CHUNK_LENGTH);
		expect(chunks[0]).toMatchObject({ index: 1, total: 1 });
	});

	it("splits a large hunk without losing its added line mapping", () => {
		const largeLine = "x".repeat(MAXIMUM_REVIEW_CHUNK_LENGTH + 100);
		const chunks = createReviewInputChunks(
			`diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +1 @@\n+${largeLine}\n`,
		);

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.diff.length <= MAXIMUM_REVIEW_CHUNK_LENGTH)).toBe(
			true,
		);
		expect(chunks.every((chunk) => chunk.changedLines.get("src/example.ts")?.has(1))).toBe(
			true,
		);
	});
});

const SAMPLE_DIFF = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1,3 @@
 export const value = 1;
+export const enabled = true;
+export const retries = 3;
`;
