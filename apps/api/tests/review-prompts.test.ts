import { describe, expect, it } from "vitest";

import type { ReviewContextFile, ReviewInput, ReviewInputChunk } from "#features/review";
import {
	createJudgePrompt,
	createReviewPrompt,
} from "../src/integrations/gemini/utils/review-prompts.util.js";

const CONTEXT_FILES: readonly ReviewContextFile[] = [
	{ kind: "loaded", path: "src/leaf.ts", content: "export const leaf = 2;" },
	{
		kind: "loaded",
		path: "src/caller.ts",
		content: "import { leaf } from './leaf.js'; callerContractSentinel(leaf);",
	},
	{
		kind: "loaded",
		path: "src/entry.ts",
		content: "import './caller.js'; entryContractSentinel();",
	},
	{ kind: "loaded", path: "src/unrelated.ts", content: "unrelatedContentSentinel();" },
];

function inputFor(files: readonly ReviewContextFile[]): ReviewInput {
	const chunk: ReviewInputChunk = {
		changedLines: new Map([["src/leaf.ts", new Set([1])]]),
		diff: "diff --git a/src/leaf.ts b/src/leaf.ts\n--- a/src/leaf.ts\n+++ b/src/leaf.ts\n@@ -1 +1 @@\n-old\n+new\n",
		referenceBefore: "",
		referenceAfter: "",
		index: 1,
		total: 1,
	};
	return {
		baseSha: "base",
		headSha: "head",
		body: null,
		title: "Change the leaf contract",
		chunks: [chunk],
		githubInstallationAccountLogin: "takeat",
		pullRequestNumber: 1,
		repositoryFullName: "takeat/example",
		reviewRunId: "run",
		repositoryContext: {
			repositoryFullName: "takeat/example",
			revision: "head",
			omittedFileCount: 0,
			files,
		},
	};
}

describe("review context packets", () => {
	it.each([CONTEXT_FILES, [...CONTEXT_FILES].reverse()])(
		"includes preloaded callers and their connected contracts in both prompts regardless of source order",
		(...files) => {
			const input = inputFor(files);
			const chunk = input.chunks[0]!;
			const prompts = [
				createReviewPrompt(input, chunk, "not_enabled"),
				createJudgePrompt(input, {
					candidates: [
						{
							index: 0,
							evidenceId: "e",
							finding: {
								path: "src/leaf.ts",
								line: 1,
								severity: "high",
								title: "Breaks a caller",
								rationale: "Caller contract differs.",
							},
						},
					],
					evidence: [
						{
							id: "e",
							diff: chunk.diff,
							referenceBefore: "",
							referenceAfter: "",
							investigation: { kind: "not_enabled" },
						},
					],
				}),
			];

			for (const prompt of prompts) {
				expect(prompt).toContain("callerContractSentinel");
				expect(prompt).toContain("entryContractSentinel");
				expect(prompt).not.toContain("unrelatedContentSentinel");
				expect(prompt).toContain("src/unrelated.ts");
			}
		},
	);

	it("keeps sorted repository documents ahead of varying PR data while attributing their exact revision", () => {
		const files: readonly ReviewContextFile[] = [
			...CONTEXT_FILES,
			{ kind: "loaded", path: ".codekeat/z-domain.md", content: "Domain contract sentinel" },
			{ kind: "loaded", path: ".codekeat/a-map.md", content: "Architecture map sentinel" },
		];
		const first = { ...inputFor(files), title: "First PR", body: "First full description" };
		const second: ReviewInput = {
			...inputFor([...files].reverse()),
			title: "Second PR",
			body: "Second full description\nA deliberate change with all its details.",
			headSha: "second-head",
			pullRequestNumber: 2,
			repositoryContext: {
				...first.repositoryContext,
				files: [...files].reverse(),
				revision: "second-head",
			},
		};
		const firstPrompt = createReviewPrompt(first, first.chunks[0]!, "not_enabled");
		const secondPrompt = createReviewPrompt(second, second.chunks[0]!, "not_enabled");
		const attribution = ',"revision":';
		const firstPrefix = firstPrompt.slice(0, firstPrompt.indexOf(attribution));
		const secondPrefix = secondPrompt.slice(0, secondPrompt.indexOf(attribution));
		expect(firstPrefix).toBe(secondPrefix);
		expect(firstPrefix).toContain("Architecture map sentinel");
		expect(firstPrefix).toContain("Domain contract sentinel");
		expect(firstPrefix.indexOf(".codekeat/a-map.md")).toBeLessThan(
			firstPrefix.indexOf(".codekeat/z-domain.md"),
		);
		expect(secondPrompt).toContain(second.body);
		expect(secondPrompt).toContain('"revision":"second-head"');
		expect(secondPrompt.indexOf("Domain contract sentinel")).toBeLessThan(
			secondPrompt.indexOf("Second PR"),
		);
	});
});
