import { describe, expect, it } from "vitest";

import type { ReviewFinding, ReviewInputChunk } from "#features/review";
import {
	createReviewFindingJudgeBatches,
	extractReviewFindingEvidence,
	MAXIMUM_JUDGE_BATCH_FINDINGS,
} from "../src/features/review/utils/review-finding-evidence.util.js";

const BASE_FINDING: ReviewFinding = {
	severity: "high",
	path: "src/example.ts",
	line: 2,
	title: "Concrete failure",
	rationale: "The changed line fails in a reachable scenario.",
};

describe("review finding evidence", () => {
	it("extracts the containing hunk with renamed file headers", () => {
		const chunk = createChunk(
			[
				"diff --git a/src/old.ts b/src/new.ts",
				"similarity index 90%",
				"rename from src/old.ts",
				"rename to src/new.ts",
				"--- a/src/old.ts",
				"+++ b/src/new.ts",
				"@@ -1 +1,2 @@",
				" old",
				"+new",
				"@@ -9 +10,2 @@",
				" old-ten",
				"+new-ten",
				"",
			].join("\n"),
			1,
		);

		const first = extractReviewFindingEvidence(chunk, {
			...BASE_FINDING,
			path: "src/new.ts",
		});
		const second = extractReviewFindingEvidence(chunk, {
			...BASE_FINDING,
			path: "src/new.ts",
			line: 11,
		});

		expect(first?.diff).toContain("diff --git a/src/old.ts b/src/new.ts");
		expect(first?.diff).toContain("@@ -1 +1,2 @@");
		expect(first?.diff).not.toContain("@@ -9 +10,2 @@");
		expect(second?.diff).toContain("@@ -9 +10,2 @@");
	});

	it("deduplicates evidence for findings in the same hunk", () => {
		const chunk = createChunk(simpleDiff("src/example.ts", ["+first", "+second"]), 1);
		const batches = createReviewFindingJudgeBatches([
			{ chunk, finding: { ...BASE_FINDING, line: 1 } },
			{ chunk, finding: { ...BASE_FINDING, line: 2, title: "Second failure" } },
		]);

		expect(batches).toHaveLength(1);
		expect(batches?.[0]?.input.evidence).toHaveLength(1);
		expect(batches?.[0]?.input.candidates.map((candidate) => candidate.evidenceId)).toEqual([
			batches?.[0]?.input.evidence[0]?.id,
			batches?.[0]?.input.evidence[0]?.id,
		]);
	});

	it("packs at most fifty findings while preserving deterministic order", () => {
		const chunk = createChunk(simpleDiff("src/example.ts", ["+line"]), 1);
		const candidates = Array.from({ length: MAXIMUM_JUDGE_BATCH_FINDINGS + 1 }, (_, index) => ({
			chunk,
			finding: { ...BASE_FINDING, line: 1, title: `Failure ${index}` },
		}));

		const batches = createReviewFindingJudgeBatches(candidates);

		expect(batches?.map((batch) => batch.findings.length)).toEqual([50, 1]);
		expect(batches?.flatMap((batch) => batch.findings.map((finding) => finding.title))).toEqual(
			candidates.map((candidate) => candidate.finding.title),
		);
	});

	it("separates batches above the evidence limit and keeps an oversized hunk intact", () => {
		const firstLine = `+${"a".repeat(49_000)}`;
		const secondLine = `+${"b".repeat(49_000)}`;
		const oversizedLine = `+${"c".repeat(90_000)}`;
		const first = createChunk(simpleDiff("src/first.ts", [firstLine]), 1);
		const second = createChunk(simpleDiff("src/second.ts", [secondLine]), 2);
		const oversized = createChunk(simpleDiff("src/oversized.ts", [oversizedLine]), 3);
		const batches = createReviewFindingJudgeBatches([
			{ chunk: first, finding: { ...BASE_FINDING, path: "src/first.ts", line: 1 } },
			{ chunk: second, finding: { ...BASE_FINDING, path: "src/second.ts", line: 1 } },
			{ chunk: oversized, finding: { ...BASE_FINDING, path: "src/oversized.ts", line: 1 } },
		]);

		expect(batches).toHaveLength(3);
		expect(batches?.[2]?.input.evidence[0]?.diff).toContain(oversizedLine);
	});
});

function createChunk(diff: string, index: number): ReviewInputChunk {
	return {
		changedLines: new Map(),
		diff,
		referenceBefore: "",
		referenceAfter: "",
		index,
		total: 3,
	};
}

function simpleDiff(path: string, addedLines: readonly string[]): string {
	return [
		`diff --git a/${path} b/${path}`,
		`--- a/${path}`,
		`+++ b/${path}`,
		`@@ -0,0 +1,${addedLines.length} @@`,
		...addedLines,
		"",
	].join("\n");
}
