import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ReviewFindingJudgeInput, ReviewFindingEvidence, ReviewInput } from "#features/review";
import {
	focusedJudgeResponseSchema,
	judgeResponseSchema,
	prepareFocusedJudgePacket,
	splitFocusedJudgments,
} from "../src/integrations/gemini/utils/review-focused-judge.util.js";

const diff =
	"diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -10 +20 @@\n-old\n+new\n";
const candidate = {
	evidenceId: "one",
	index: 4,
	finding: {
		severity: "high" as const,
		path: "file.ts",
		line: 20,
		title: "Changed boundary",
		rationale: "Reachable contract failure",
	},
};
const evidence = {
	id: "one",
	diff,
	referenceBefore: "Original before context",
	referenceAfter: "Original after context",
	investigation: { kind: "not_enabled" as const },
};
const batch: ReviewFindingJudgeInput = {
	candidates: [candidate, { ...candidate, index: 8 }],
	evidence: [evidence],
};
const input: ReviewInput = {
	baseSha: "base",
	headSha: "head",
	body: "Full intended contract",
	title: "Change contract",
	repositoryFullName: "takeat/example",
	githubInstallationAccountLogin: "example",
	pullRequestNumber: 1,
	reviewRunId: "run",
	chunks: [],
	repositoryContext: {
		repositoryFullName: "takeat/example",
		revision: "head",
		omittedFileCount: 0,
		files: [
			{
				kind: "loaded",
				path: "file.ts",
				content: Array(20).fill("Full changed file").join("\n"),
			},
			{ kind: "loaded", path: ".codekeat/README.md", content: "Domain contract" },
		],
	},
};

describe("focused judge", () => {
	it("escalates uncertain indices with their original full evidence and preserves decided indices", () => {
		const response = focusedJudgeResponseSchema.parse({
			judgments: [
				{ index: 8, kind: "needs_evidence", gaps: ["Missing caller"] },
				{ index: 4, kind: "approved", rationale: "Verified reachable failure" },
			],
		});
		expect(splitFocusedJudgments(response, batch)).toEqual({
			decided: [
				{
					index: 4,
					judgment: { kind: "approved", rationale: "Verified reachable failure" },
				},
			],
			escalation: { candidates: [batch.candidates[1]], evidence: [evidence] },
			gaps: [{ index: 8, gaps: ["Missing caller"] }],
		});
		expect(judgeResponseSchema.safeParse(response).success).toBe(false);
		expect(
			focusedJudgeResponseSchema.safeParse({
				judgments: [{ index: 4, kind: "needs_evidence", gaps: [] }],
			}).success,
		).toBe(false);
	});

	it("forces additional evidence for a missing head even when the focused model approves", () => {
		const response = focusedJudgeResponseSchema.parse({
			judgments: [
				{ index: 4, kind: "approved", rationale: "Model agrees" },
				{ index: 8, kind: "rejected", rationale: "Guard prevents failure" },
			],
		});
		const result = splitFocusedJudgments(response, batch, [4]);
		expect(result.decided).toEqual([
			{ index: 8, judgment: { kind: "rejected", rationale: "Guard prevents failure" } },
		]);
		expect(result.escalation.candidates.map((entry) => entry.index)).toEqual([4]);
		expect(result.gaps).toEqual([{ index: 4, gaps: ["decisive_evidence_unavailable"] }]);
	});

	it.each([{ indices: [4] }, { indices: [4, 4] }, { indices: [4, 9] }])(
		"rejects incomplete, duplicate or unexpected verdict indices $indices",
		({ indices }) => {
			const response = focusedJudgeResponseSchema.parse({
				judgments: indices.map((index) => ({
					index,
					kind: "rejected",
					rationale: "Not a defect",
				})),
			});
			expect(() => splitFocusedJudgments(response, batch)).toThrow(
				"The review model returned an invalid response.",
			);
		},
	);

	it("preserves domain documents and original inline context without a catalog", async () => {
		const packet = await Effect.runPromise(prepareFocusedJudgePacket(input, batch, null));
		expect(packet.unavailableIndices).toEqual([]);
		for (const text of [
			"Domain contract",
			"Full intended contract",
			"Original before context",
			"Original after context",
			"Full changed file",
			"+new",
		])
			expect(packet.prompt).toContain(text);
	});

	it.each(["", "line\n"])(
		"does not use domain documents or nonexistent lines as candidate head proof (%j)",
		async (content) => {
			const packet = await Effect.runPromise(
				prepareFocusedJudgePacket(
					{
						...input,
						repositoryContext: {
							...input.repositoryContext,
							files: [
								{
									kind: "loaded",
									path: ".codekeat/README.md",
									content: "Domain contract",
								},
								{ kind: "loaded", path: "file.ts", content },
							],
						},
					},
					batch,
					null,
				),
			);
			expect(packet.unavailableIndices).toEqual([4, 8]);
		},
	);

	it("escalates an undelivered citation and preserves actual exchanges without leaking unrelated hypotheses", async () => {
		const hypothesis = {
			path: "file.ts",
			line: 20,
			scenario: "Caller permits zero",
			expectedBehavior: "Preserve operation",
			observedBehavior: "Fails",
			outcome: "candidate" as const,
			evidence: [
				{
					role: "head" as const,
					path: "remote-caller.ts",
					revision: "head",
					startLine: 1,
					endLine: 1,
				},
			],
			missingEvidence: [],
		};
		const original: ReviewFindingEvidence = {
			...evidence,
			investigation: {
				kind: "verified",
				context: "available",
				exchanges: [
					{
						tool: "domain_contract",
						argumentsJson: "{}",
						responseJson: '{"text":"Actual remote contract"}',
					},
				],
				conclusion: {
					status: "complete",
					reviewedPaths: ["file.ts"],
					hypotheses: [
						hypothesis,
						{ ...hypothesis, path: "unrelated.ts", scenario: "UNRELATED_SCENARIO" },
					],
				},
			},
		};
		const packet = await Effect.runPromise(
			prepareFocusedJudgePacket(
				input,
				{ candidates: [candidate], evidence: [original] },
				null,
			),
		);
		expect(packet.unavailableIndices).toEqual([4]);
		expect(packet.prompt).toContain("Actual remote contract");
		expect(packet.prompt).toContain("remote-caller.ts");
		expect(packet.prompt).not.toContain("UNRELATED_SCENARIO");
	});
});
