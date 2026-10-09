import { createGoogle } from "@ai-sdk/google";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GeminiReviewService } from "#integrations/gemini";
import type {
	ReviewConclusion,
	ReviewFinding,
	ReviewInput,
	ReviewInputChunk,
	ReviewSourceCatalog,
	ReviewSourceDocument,
	ReviewModelResult,
} from "#features/review";
import { readReviewSourceRange } from "../src/features/review/utils/review-source-range.util.js";

const MODEL = {
	id: "01991700-0000-7000-8000-000000000038",
	apiName: "gemini-3.8-flash",
	inputNanoUsdPerToken: 750,
	cachedInputNanoUsdPerToken: 75,
	outputNanoUsdPerToken: 3750,
};
const PATH = "src/example.ts";
const CHUNK: ReviewInputChunk = {
	changedLines: new Map([[PATH, new Set([2])]]),
	diff: `diff --git a/${PATH} b/${PATH}\n--- a/${PATH}\n+++ b/${PATH}\n@@ -1,2 +1,2 @@\n function example() {\n-old\n+new`,
	referenceBefore: "",
	referenceAfter: "",
	index: 1,
	total: 1,
};
const CONTENT = "function example() {\n  return 1;\n}\n";
const INPUT: ReviewInput = {
	baseSha: "branch-tip",
	headSha: "head-sha",
	body: "Preserve existing caller behavior.",
	title: "Adjust example",
	chunks: [CHUNK],
	githubInstallationAccountLogin: "external-owner",
	pullRequestNumber: 1,
	repositoryFullName: "external-owner/example",
	reviewRunId: "provenance-run",
	repositoryContext: {
		repositoryFullName: "external-owner/example",
		revision: "head-sha",
		files: [{ kind: "loaded", path: PATH, content: CONTENT }],
		omittedFileCount: 0,
	},
};
const FINDING: ReviewFinding = {
	severity: "high",
	path: PATH,
	line: 2,
	title: "Concrete candidate",
	rationale: "Reachable caller contract changes.",
};

function conclusion(
	evidence: ReviewConclusion["hypotheses"][number]["evidence"][number],
	outcome: "refuted" | "candidate" = "refuted",
): ReviewConclusion {
	return {
		status: "complete",
		reviewedPaths: [PATH],
		hypotheses: [
			{
				path: PATH,
				line: 2,
				scenario: "Valid caller input",
				expectedBehavior: "Preserve caller contract",
				observedBehavior: "Checked exact source",
				outcome,
				evidence: [evidence],
				missingEvidence: [],
			},
		],
	};
}
const HEAD = {
	path: PATH,
	role: "head" as const,
	revision: INPUT.headSha,
	startLine: 1,
	endLine: 2,
};

function output(recorded: ReviewConclusion, findings: readonly ReviewFinding[] = []): Response {
	return google([{ text: JSON.stringify({ conclusion: recorded, findings }) }]);
}
function google(parts: readonly object[], finishReason = "STOP"): Response {
	return Response.json({
		candidates: [{ content: { role: "model", parts }, finishReason }],
		usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
	});
}
function call(name: string, args: object): Response {
	return google([{ functionCall: { name, args }, thoughtSignature: "opaque-signature" }]);
}
function harness(responses: readonly Response[]) {
	const remaining = [...responses];
	const requests: string[] = [];
	const fetchGoogle: typeof fetch = async (_url, init) => {
		if (typeof init?.body !== "string") throw new Error("Missing Google request body.");
		requests.push(init.body);
		const response = remaining.shift();
		if (response === undefined) throw new Error("Unexpected extra model call.");
		return response;
	};
	return {
		requests,
		model: new GeminiReviewService(
			createGoogle({ apiKey: "test-key", fetch: fetchGoogle }),
			{ listTools: async () => [], callTool: async () => ({}) },
			pino({ enabled: false }),
		),
	};
}
function catalog(content = CONTENT, rejected: string[] = []): ReviewSourceCatalog {
	const documents: readonly ReviewSourceDocument[] = ["head", "before"].map((role) => ({
		source: {
			role: role === "head" ? "head" : "before",
			path: PATH,
			revision: role === "head" ? INPUT.headSha : "merge-base",
			repositoryFullName: INPUT.repositoryFullName,
			contentHash: null,
		},
		content,
	}));
	return {
		revisions: documents.map((document) => document.source),
		list: async () => ({
			kind: "page",
			entries: documents.map((document) => ({
				...document.source,
				kind: "file",
				sizeBytes: null,
			})),
			totalEntries: documents.length,
			nextCursor: null,
		}),
		read: async ({ source, range }) => {
			const document = documents.find(
				(entry) => entry.source.role === source.role && entry.source.path === source.path,
			);
			return document === undefined
				? { kind: "missing", source }
				: readReviewSourceRange(document, range);
		},
		search: async () => ({
			kind: "page",
			matches: [],
			totalSources: 0,
			scannedSources: 0,
			unavailable: [],
			nextCursor: null,
		}),
		related: async () => ({ kind: "page", entries: [], totalEntries: 0, nextCursor: null }),
		recordInvestigation: async (_tool, _arguments, response) => {
			rejected.push(response);
			return {
				role: "investigation",
				path: "mcp/rejected-response",
				revision: "captured",
				repositoryFullName: INPUT.repositoryFullName,
				contentHash: null,
			};
		},
	};
}
function execution(sources: ReviewSourceCatalog) {
	return {
		sources,
		signal: new AbortController().signal,
		recordUsage: () => {},
		recordMetric: () => {},
	};
}

function outcome(
	result: Promise<ReviewModelResult>,
): Promise<"verified" | "context_response_invalid"> {
	return result.then(
		() => "verified",
		(error: unknown) =>
			z.object({ issue: z.literal("context_response_invalid") }).parse(error).issue,
	);
}
const WITHOUT_INLINE: ReviewInput = {
	...INPUT,
	repositoryContext: { ...INPUT.repositoryContext, files: [] },
};

describe("review evidence provenance through Google transport", () => {
	it("repairs an unread citation by retrieving the missing source without restarting investigation", async () => {
		const before = { ...HEAD, role: "before" as const, revision: "merge-base" };
		const rejected: string[] = [];
		const receipts: number[] = [];
		const { model, requests } = harness([
			call("source_read", {
				source: { role: "head", path: PATH },
				range: { kind: "lines", startLine: 1, lineCount: 3 },
			}),
			output(conclusion(before, "candidate"), [FINDING]),
			call("source_read", {
				source: { role: "before", path: PATH },
				range: { kind: "lines", startLine: 1, lineCount: 3 },
			}),
			output(conclusion(before, "candidate"), [FINDING]),
		]);
		await expect(
			model.review(MODEL, WITHOUT_INLINE, CHUNK, {
				...execution(catalog(CONTENT, rejected)),
				recordUsage: (receipt) => {
					receipts.push(receipt.stepNumber);
				},
			}),
		).resolves.toMatchObject({
			findings: [FINDING],
			investigation: { kind: "verified" },
			usage: { inputTokens: 40, outputTokens: 4 },
		});
		expect(requests).toHaveLength(4);
		expect(receipts).toEqual([0, 1, 2, 3]);
		expect(requests[2]).toContain("evidence_not_delivered");
		expect(requests[2]).toContain("opaque-signature");
		expect(requests[2]).toContain("functionResponse");
		expect(requests[2]).toContain(INPUT.body);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toContain("merge-base");
	});

	it("preserves a direct reference to original tool output across response repair", async () => {
		const path = "src/" + "long_changed_source_name_".repeat(20) + ".ts";
		const changed: ReviewInputChunk = {
			...CHUNK,
			changedLines: new Map([[path, new Set([2])]]),
			diff: CHUNK.diff.replaceAll(PATH, path),
		};
		const input: ReviewInput = { ...WITHOUT_INLINE, chunks: [changed] };
		const document: ReviewSourceDocument = {
			source: {
				role: "head",
				path,
				revision: INPUT.headSha,
				repositoryFullName: INPUT.repositoryFullName,
				contentHash: "git:" + "a".repeat(40),
			},
			content: "// original-source " + "x".repeat(2900) + "\nreturn 1;\n",
		};
		const archived: { tool: string; response: string }[] = [];
		const sources: ReviewSourceCatalog = {
			...catalog(),
			read: async ({ range }) => readReviewSourceRange(document, range),
			recordInvestigation: async (tool, _arguments, response) => {
				archived.push({ tool, response });
				return {
					role: "investigation",
					path: "mcp/" + "b".repeat(64),
					revision: "unconfirmed",
					repositoryFullName: INPUT.repositoryFullName,
					contentHash: "sha256:" + "b".repeat(64),
				};
			},
		};
		const valid: ReviewConclusion = {
			...conclusion({ ...HEAD, path }),
			reviewedPaths: [path],
			hypotheses: conclusion({ ...HEAD, path }).hypotheses.map((entry) => ({
				...entry,
				path,
			})),
		};
		const invalid: ReviewConclusion = {
			...valid,
			hypotheses: valid.hypotheses.map((entry) => ({
				...entry,
				evidence: [{ ...HEAD, path, revision: "invented" }],
			})),
		};
		const list = () =>
			call("source_list", { role: "head", prefix: "", cursor: null, limit: 10 });
		const { model, requests } = harness([
			call("source_read", {
				source: { role: "head", path },
				range: { kind: "lines", startLine: 1, lineCount: 3 },
			}),
			list(),
			list(),
			list(),
			output(invalid),
			output(valid),
		]);
		await expect(
			model.review(MODEL, input, changed, execution(sources)),
		).resolves.toMatchObject({ findings: [], investigation: { kind: "verified" } });
		expect(requests).toHaveLength(6);
		const originals = archived.filter((entry) => entry.tool === "review_transcript");
		expect(originals).toHaveLength(1);
		expect(originals[0]?.response).toContain("original-source");
		expect(requests[5]).toContain("archived_tool_result");
		expect(requests[5]).not.toContain("original-source");
	});

	it.each(["{not-json", JSON.stringify({ findings: [] })])(
		"repairs invalid structured output while preserving its paid receipt (%s)",
		async (text) => {
			const { model, requests } = harness([google([{ text }]), output(conclusion(HEAD))]);
			const receipts: number[] = [];
			await expect(
				model.review(MODEL, INPUT, CHUNK, {
					...execution(catalog()),
					recordUsage: (receipt) => {
						receipts.push(receipt.stepNumber);
					},
				}),
			).resolves.toMatchObject({ findings: [], usage: { inputTokens: 20, outputTokens: 2 } });
			expect(requests).toHaveLength(2);
			expect(receipts).toEqual([0, 1]);
			const continued = z
				.object({
					contents: z.array(
						z.object({
							role: z.string(),
							parts: z.array(z.object({ text: z.string().optional() })),
						}),
					),
				})
				.parse(JSON.parse(requests[1]!));
			expect(
				continued.contents
					.filter((entry) => entry.role === "model")
					.flatMap((entry) => entry.parts.map((part) => part.text)),
			).toContain(text);
		},
	);

	it("fails after one unsuccessful repair and retains both rejected responses and receipts", async () => {
		const bad = conclusion({ ...HEAD, revision: "invented" });
		const rejected: string[] = [];
		const receipts: number[] = [];
		const { model, requests } = harness([output(bad), output(bad)]);
		await expect(
			model.review(MODEL, INPUT, CHUNK, {
				...execution(catalog(CONTENT, rejected)),
				recordUsage: (receipt) => {
					receipts.push(receipt.stepNumber);
				},
			}),
		).rejects.toMatchObject({
			issue: "context_response_invalid",
			failure: { code: "evidence_revision_mismatch", hypothesisIndex: 0, evidenceIndex: 0 },
		});
		expect(requests).toHaveLength(2);
		expect(receipts).toEqual([0, 1]);
		expect(rejected).toHaveLength(2);
	});

	it.each(["MAX_TOKENS", "SAFETY"])(
		"does not repair a provider response terminated with %s",
		async (finishReason) => {
			const { model, requests } = harness([google([{ text: "{not-json" }], finishReason)]);
			await expect(
				model.review(MODEL, INPUT, CHUNK, execution(catalog())),
			).rejects.toBeInstanceOf(Error);
			expect(requests).toHaveLength(1);
		},
	);

	it("does not repair missing usage metadata even when the conclusion is invalid", async () => {
		const response = Response.json({
			candidates: [
				{
					content: {
						role: "model",
						parts: [
							{
								text: JSON.stringify({
									conclusion: conclusion({ ...HEAD, revision: "invented" }),
									findings: [],
								}),
							},
						],
					},
					finishReason: "STOP",
				},
			],
		});
		const { model, requests } = harness([response]);
		await expect(model.review(MODEL, INPUT, CHUNK, execution(catalog()))).rejects.toMatchObject(
			{ issue: "usage_metadata_invalid" },
		);
		expect(requests).toHaveLength(1);
	});

	it("does not repair after cancellation and preserves the received usage", async () => {
		const controller = new AbortController();
		const receipts: number[] = [];
		const { model, requests } = harness([
			output(conclusion({ ...HEAD, revision: "invented" })),
		]);
		await expect(
			model.review(MODEL, INPUT, CHUNK, {
				...execution(catalog()),
				signal: controller.signal,
				recordUsage: (receipt) => {
					receipts.push(receipt.stepNumber);
					controller.abort();
				},
			}),
		).rejects.toBeInstanceOf(Error);
		expect(requests).toHaveLength(1);
		expect(receipts).toEqual([0]);
	});

	it("reserves the third repair step for output and does not start a second investigation", async () => {
		const read = () =>
			call("source_read", {
				source: { role: "head", path: PATH },
				range: { kind: "lines", startLine: 1, lineCount: 3 },
			});
		const { model, requests } = harness([
			output(conclusion({ ...HEAD, revision: "invented" })),
			read(),
			read(),
			output(conclusion(HEAD)),
		]);
		await expect(
			model.review(MODEL, INPUT, CHUNK, execution(catalog())),
		).resolves.toMatchObject({ findings: [] });
		expect(requests).toHaveLength(4);
		const finalRequest = z
			.object({
				tools: z
					.array(
						z.object({ functionDeclarations: z.array(z.object({ name: z.string() })) }),
					)
					.optional(),
			})
			.parse(JSON.parse(requests[3]!));
		expect(finalRequest.tools).toBeUndefined();
	});

	it("accepts supplied inline sources and sends an associated candidate to the caller", async () => {
		const { model } = harness([output(conclusion(HEAD, "candidate"), [FINDING])]);
		await expect(model.review(MODEL, INPUT, CHUNK)).resolves.toMatchObject({
			findings: [FINDING],
			investigation: { kind: "verified" },
		});
	});

	it.each([
		{ ...HEAD, path: "src/invented.ts" },
		{ ...HEAD, endLine: 100 },
		{ ...HEAD, revision: "different-head" },
		{ ...HEAD, role: "investigation" as const, revision: "unconfirmed" },
	])("rejects an ungrounded citation $path:$endLine at $revision", async (evidence) => {
		const { model } = harness([output(conclusion(evidence)), output(conclusion(evidence))]);
		await expect(model.review(MODEL, INPUT, CHUNK)).rejects.toMatchObject({
			issue: "context_response_invalid",
		});
	});

	it.each([
		{
			recorded: conclusion(HEAD, "candidate"),
			findings: [],
			failure: { code: "candidate_missing_finding", hypothesisIndex: 0 },
		},
		{
			recorded: {
				...conclusion(HEAD),
				hypotheses: [
					...conclusion(HEAD).hypotheses,
					...conclusion(HEAD, "candidate").hypotheses,
				],
			},
			findings: [],
			failure: { code: "candidate_missing_finding", hypothesisIndex: 1 },
		},
		{
			recorded: conclusion(HEAD),
			findings: [FINDING],
			failure: { code: "finding_missing_candidate", findingIndex: 0 },
		},
		{
			recorded: conclusion(HEAD, "candidate"),
			findings: [{ ...FINDING, line: 1 }],
			failure: { code: "finding_location_invalid", findingIndex: 0 },
		},
	])(
		"rejects an invalid finding association with $failure.code",
		async ({ recorded, findings, failure }) => {
			const { model } = harness([output(recorded, findings), output(recorded, findings)]);
			await expect(model.review(MODEL, INPUT, CHUNK)).rejects.toMatchObject({
				issue: "context_response_invalid",
				failure,
			});
		},
	);

	it.each(["merge-base", INPUT.baseSha])(
		"uses the before catalog revision, not the branch tip (%s)",
		async (revision) => {
			const { model } = harness([
				call("source_read", {
					source: { role: "before", path: PATH },
					range: { kind: "lines", startLine: 1, lineCount: 3 },
				}),
				output(conclusion({ ...HEAD, role: "before", revision })),
				...(revision === "merge-base"
					? []
					: [output(conclusion({ ...HEAD, role: "before", revision }))]),
			]);
			const result = model.review(MODEL, WITHOUT_INLINE, CHUNK, execution(catalog()));
			expect(await outcome(result)).toBe(
				revision === "merge-base" ? "verified" : "context_response_invalid",
			);
		},
	);

	it("does not turn manifest references into evidence of a read", async () => {
		const { model } = harness([
			call("source_list", { role: "head", prefix: "", cursor: null, limit: 10 }),
			output(conclusion(HEAD)),
			output(conclusion(HEAD)),
		]);
		await expect(
			model.review(MODEL, WITHOUT_INLINE, CHUNK, execution(catalog())),
		).rejects.toMatchObject({ issue: "context_response_invalid" });
	});

	it.each([false, true])(
		"requires all column pages before accepting an entire long line (continued: %s)",
		async (continued) => {
			const first = call("source_read", {
				source: { role: "head", path: PATH },
				range: { kind: "lines", startLine: 1, lineCount: 1 },
			});
			const second = call("source_read", {
				source: { role: "head", path: PATH },
				range: { kind: "columns", line: 1, startColumn: 4096, columnCount: 16000 },
			});
			const { model } = harness([
				first,
				...(continued ? [second] : []),
				output(conclusion({ ...HEAD, endLine: 1 })),
				...(continued ? [] : [output(conclusion({ ...HEAD, endLine: 1 }))]),
			]);
			const result = model.review(
				MODEL,
				WITHOUT_INLINE,
				CHUNK,
				execution(catalog("x".repeat(6000))),
			);
			expect(await outcome(result)).toBe(continued ? "verified" : "context_response_invalid");
		},
	);

	it("keeps retrieval enabled after an ungrounded complete checkpoint", async () => {
		const invalid = conclusion({ ...HEAD, path: "src/invented.ts" });
		const incomplete: ReviewConclusion = {
			status: "incomplete",
			reviewedPaths: [PATH],
			hypotheses: [
				{
					...conclusion(HEAD).hypotheses[0]!,
					outcome: "unresolved",
					evidence: [],
					missingEvidence: ["Need exact source"],
				},
			],
			gaps: ["Need exact source"],
		};
		const { model, requests } = harness([
			call("investigation_checkpoint", {
				conclusion: incomplete,
				nextTools: ["source_search"],
			}),
			call("investigation_checkpoint", { conclusion: invalid, nextTools: [] }),
			call("source_read", {
				source: { role: "head", path: PATH },
				range: { kind: "lines", startLine: 1, lineCount: 3 },
			}),
			output(conclusion(HEAD)),
		]);
		await expect(
			model.review(MODEL, WITHOUT_INLINE, CHUNK, execution(catalog())),
		).resolves.toMatchObject({ investigation: { kind: "verified" } });
		expect(requests[2]).toContain('"name":"source_read"');
		expect(requests[2]).toContain("correction_required");
		expect(requests[2]).toContain("evidence_not_delivered");
	});

	it("does not combine a financial path with a return added in another file", async () => {
		const other = "src/payment.ts";
		const input: ReviewInput = {
			...INPUT,
			repositoryContext: {
				...INPUT.repositoryContext,
				files: [
					...INPUT.repositoryContext.files,
					{ kind: "loaded", path: other, content: CONTENT },
				],
			},
		};
		const chunk: ReviewInputChunk = {
			...CHUNK,
			changedLines: new Map([
				[PATH, new Set([2])],
				[other, new Set([2])],
			]),
			diff: `diff --git a/${PATH} b/${PATH}\n--- a/${PATH}\n+++ b/${PATH}\n@@ -1 +1 @@\n-old\n+return newValue\ndiff --git a/${other} b/${other}\n--- a/${other}\n+++ b/${other}\n@@ -1 +1 @@\n-old\n+const title = "Adjusted"`,
		};
		const single = conclusion(HEAD);
		const recorded: ReviewConclusion = {
			status: "complete",
			reviewedPaths: [PATH, other],
			hypotheses: [
				...single.hypotheses,
				{ ...single.hypotheses[0]!, path: other, evidence: [{ ...HEAD, path: other }] },
			],
		};
		const { model, requests } = harness([output(recorded)]);
		await expect(model.review(MODEL, input, chunk)).resolves.toMatchObject({ findings: [] });
		expect(requests).toHaveLength(1);
	});
});
