import { describe, expect, it } from "vitest";
import { createReviewInputChunks } from "../src/features/github/services/github-review-input.service.js";
import {
	assertReviewCoverage,
	planReviewChunks,
	splitReviewChunk,
} from "../src/features/review/utils/review-work-planner.util.js";
import type { ReviewInput } from "#features/review";

function diff(path: string): string {
	return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@ function\n first\n-old\n+new\n tail\n`;
}
function input(raw: string): ReviewInput {
	return {
		baseSha: "base",
		headSha: "head",
		body: null,
		chunks: createReviewInputChunks(raw),
		githubInstallationAccountLogin: "takeat",
		pullRequestNumber: 1,
		repositoryFullName: "takeat/app",
		reviewRunId: "run",
		repositoryContext: {
			repositoryFullName: "takeat/app",
			revision: "head",
			files: [],
			omittedFileCount: 0,
		},
		title: "change",
	};
}

describe("durable review planning", () => {
	it("packs adjacent related files while keeping every original byte and isolating unrelated work", () => {
		const original = input(diff("src/a.ts") + diff("src/b.ts") + diff("other/c.ts"));
		const planned = planReviewChunks(original, 10000);
		expect(planned).toHaveLength(2);
		expect(planned.map((chunk) => chunk.diff).join("")).toBe(
			original.chunks.map((chunk) => chunk.diff).join(""),
		);
		expect([...planned[0]!.changedLines.keys()]).toEqual(["src/a.ts", "src/b.ts"]);
		assertReviewCoverage(original.chunks, planned);
	});
	it("subdivides a single hunk repeatedly while preserving changed-line coordinates, deletions and no-newline markers", () => {
		const original = createReviewInputChunks(
			diff("src/a.ts").replace("+new\n", "+new\n\\ No newline at end of file\n"),
		);
		let leaves = [...original];
		for (let pass = 0; pass < 4; pass++)
			leaves = leaves.flatMap((chunk) => splitReviewChunk(chunk) ?? [chunk]);
		assertReviewCoverage(original, leaves);
		expect(
			leaves
				.map((chunk) => chunk.diff)
				.join("")
				.match(/\\ No newline at end of file/g),
		).toHaveLength(1);
		expect(leaves.flatMap((chunk) => [...(chunk.changedLines.get("src/a.ts") ?? [])])).toEqual([
			2,
		]);
		expect(() =>
			assertReviewCoverage(
				original,
				leaves.filter((chunk) => !chunk.diff.includes("-old")),
			),
		).toThrow(/diff content/);
	});
	it("retains metadata-only files in coverage and refuses to claim an omitted file was reviewed", () => {
		const raw =
			"diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n";
		const original = createReviewInputChunks(raw);
		expect(splitReviewChunk(original[0]!)).toBeNull();
		assertReviewCoverage(original, original);
		expect(() => assertReviewCoverage(original, [])).toThrow(/file coverage/);
	});
});
