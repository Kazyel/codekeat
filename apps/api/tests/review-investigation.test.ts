import { createGoogle } from "@ai-sdk/google";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiReviewService } from "#integrations/gemini";
import type {
	ReviewConclusion,
	ReviewFinding,
	ReviewInput,
	ReviewSourceCatalog,
} from "#features/review";

const model = {
	id: "model",
	apiName: "gemini-3.8-flash",
	inputNanoUsdPerToken: 750,
	cachedInputNanoUsdPerToken: 75,
	outputNanoUsdPerToken: 3_750,
};
const path = "src/cost.ts";
const chunk = {
	changedLines: new Map([[path, new Set([3])]]),
	diff: "@@ -1,3 +1,4 @@\n function cost(input, cached, output) {\n+ if (input === cached) return 0;\n  return input + output;",
	referenceBefore: "",
	referenceAfter: "",
	index: 1,
	total: 1,
};
const input: ReviewInput = {
	baseSha: "before",
	headSha: "head",
	body: "Preserve the usage accounting contract",
	title: "Update accounting",
	chunks: [chunk],
	githubInstallationAccountLogin: "evaluation",
	pullRequestNumber: 1,
	repositoryFullName: "test/accounting",
	reviewRunId: "run",
	repositoryContext: {
		repositoryFullName: "test/accounting",
		revision: "head",
		files: [
			{
				kind: "loaded",
				path,
				content:
					"function cost(input, cached, output) {\n if (input === cached) return 0;\n return input + output;\n}",
			},
		],
		omittedFileCount: 0,
	},
};
const conclusion: ReviewConclusion = {
	status: "complete",
	reviewedPaths: [path],
	hypotheses: [
		{
			path,
			line: 3,
			scenario: "Primary scenario sentinel",
			expectedBehavior: "Charge reported usage",
			observedBehavior: "No defect found in examined scenario",
			outcome: "refuted",
			evidence: [{ path, role: "head", revision: "head", startLine: 1, endLine: 4 }],
			missingEvidence: [],
		},
	],
};
const finding: ReviewFinding = {
	path,
	line: 3,
	severity: "medium",
	title: "Output usage is ignored",
	rationale:
		"With equal input and cached input and positive output, the new return loses output charges.",
};
const usageMetadata = {
	promptTokenCount: 100,
	candidatesTokenCount: 10,
	cachedContentTokenCount: 0,
};

function response(value: z.JSONType): Response {
	return Response.json({
		candidates: [
			{
				content: { role: "model", parts: [{ text: JSON.stringify(value) }] },
				finishReason: "STOP",
			},
		],
		usageMetadata,
	});
}
function call(name: string, args: z.JSONType): Response {
	return Response.json({
		candidates: [
			{
				content: {
					role: "model",
					parts: [{ functionCall: { name, args }, thoughtSignature: "opaque" }],
				},
				finishReason: "STOP",
			},
		],
		usageMetadata,
	});
}
function harness(responses: readonly Response[]) {
	const requests: z.JSONType[] = [];
	const queue = [...responses];
	const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
		if (typeof init?.body !== "string") throw new Error("Missing request body");
		requests.push(z.json().parse(JSON.parse(init.body)));
		const next = queue.shift();
		if (next === undefined) throw new Error("Unexpected paid step");
		return next;
	});
	const service = new GeminiReviewService(
		createGoogle({ apiKey: "test", fetch: fetcher }),
		{ listTools: async () => [], callTool: async () => ({ content: [] }) },
		pino({ level: "silent" }),
	);
	return { service, requests, fetcher };
}

describe("evidence-driven investigation through the AI SDK", () => {
	it("independently discovers a financial boundary defect after an empty first pass and accounts for both", async () => {
		const second: ReviewConclusion = {
			...conclusion,
			hypotheses: [
				{
					...conclusion.hypotheses[0]!,
					scenario: "Cached input with positive output",
					observedBehavior: "Return bypasses output charge",
					outcome: "candidate",
				},
			],
		};
		const h = harness([
			response({ findings: [], conclusion }),
			response({ findings: [finding], conclusion: second }),
		]);
		const result = await h.service.review(model, input, chunk);
		expect(result.findings).toEqual([finding]);
		expect(result.usage).toEqual({
			inputTokens: 200,
			outputTokens: 20,
			cacheTokens: 0,
			costUsdMicros: 225,
		});
		expect(result.investigation).toMatchObject({
			kind: "verified",
			conclusion: {
				status: "complete",
				hypotheses: [conclusion.hypotheses[0], second.hypotheses[0]],
			},
		});
		expect(JSON.stringify(h.requests[1])).not.toContain("Primary scenario sentinel");
		expect(JSON.stringify(h.requests[1])).toContain("descoberta independente");
	});
	it("finishes an ordinary complete investigation inline without mandatory extra model or source calls", async () => {
		const h = harness([response({ findings: [], conclusion })]);
		const ordinary = { ...chunk, diff: "@@ -1 +1 @@\n-old\n+new" };
		await expect(
			h.service.review(model, { ...input, chunks: [ordinary] }, ordinary),
		).resolves.toMatchObject({
			investigation: { kind: "verified", conclusion: { status: "complete" } },
		});
		expect(h.fetcher).toHaveBeenCalledOnce();
	});
	it.each([
		{ ...conclusion, reviewedPaths: ["other.ts"] },
		{
			...conclusion,
			hypotheses: [
				{
					...conclusion.hypotheses[0]!,
					evidence: [{ path, role: "head", revision: "stale", startLine: 1, endLine: 4 }],
				},
			],
		},
	])(
		"rejects incomplete file coverage or a stale snapshot asserted as complete",
		async (invalid) => {
			const h = harness([
				response({ findings: [], conclusion: invalid }),
				response({ findings: [], conclusion: invalid }),
			]);
			await expect(h.service.review(model, input, chunk)).rejects.toMatchObject({
				issue: "context_response_invalid",
			});
			expect(h.fetcher).toHaveBeenCalledTimes(2);
		},
	);
	it("keeps unresolved investigation visible after the bounded independent attempt", async () => {
		const incomplete: ReviewConclusion = {
			status: "incomplete",
			reviewedPaths: [path],
			hypotheses: [
				{
					...conclusion.hypotheses[0]!,
					outcome: "unresolved",
					evidence: [],
					missingEvidence: ["Caller validator unavailable"],
				},
			],
			gaps: ["Caller validator unavailable"],
		};
		const h = harness([
			response({ findings: [], conclusion: incomplete }),
			response({ findings: [], conclusion: incomplete }),
		]);
		const result = await h.service.review(model, input, chunk);
		expect(result.investigation).toMatchObject({
			kind: "verified",
			conclusion: { status: "incomplete", gaps: ["Caller validator unavailable"] },
		});
		expect(h.fetcher).toHaveBeenCalledTimes(2);
	});
	it("uses checkpoint gaps to select the next tools and reserves a complete checkpoint for conclusion", async () => {
		const ordinary = { ...chunk, diff: "@@ -1 +1 @@\n-old\n+new" };
		const incomplete: ReviewConclusion = {
			status: "incomplete",
			reviewedPaths: [path],
			hypotheses: [
				{
					...conclusion.hypotheses[0]!,
					outcome: "unresolved",
					evidence: [],
					missingEvidence: ["Read validator"],
				},
			],
			gaps: ["Read validator"],
		};
		const supported: ReviewConclusion = {
			...conclusion,
			hypotheses: conclusion.hypotheses.map((hypothesis) => ({
				...hypothesis,
				outcome: "candidate",
			})),
		};
		const h = harness([
			call("investigation_checkpoint", {
				conclusion: incomplete,
				nextTools: ["source_read"],
			}),
			call("source_read", {
				source: { role: "head", path },
				range: { kind: "lines", startLine: 1, lineCount: 4 },
			}),
			call("investigation_checkpoint", { conclusion: supported, nextTools: [] }),
			response({ findings: [finding], conclusion: supported }),
		]);
		const sources: ReviewSourceCatalog = {
			revisions: [
				{ role: "head", repositoryFullName: input.repositoryFullName, revision: "head" },
			],
			read: async () => ({
				kind: "loaded",
				source: {
					role: "head",
					path,
					revision: "head",
					contentHash: null,
					repositoryFullName: input.repositoryFullName,
				},
				content: "function cost() { return 1; }",
				totalLines: 1,
				startLine: 1,
				endLine: 1,
				startColumn: 0,
				endColumn: 29,
				nextRange: null,
			}),
			list: async () => ({ kind: "page", entries: [], totalEntries: 0, nextCursor: null }),
			search: async () => ({
				kind: "page",
				matches: [],
				scannedSources: 0,
				totalSources: 0,
				nextCursor: null,
				unavailable: [],
			}),
			related: async () => ({ kind: "page", entries: [], totalEntries: 0, nextCursor: null }),
			recordInvestigation: async () => {
				throw new Error("No transcript archival needed");
			},
		};
		const result = await h.service.review(model, input, ordinary, {
			signal: new AbortController().signal,
			sources,
			recordUsage: () => {},
			recordMetric: () => {},
		});
		expect(result.findings).toEqual([finding]);
		const requestSchema = z.object({
			tools: z
				.array(z.object({ functionDeclarations: z.array(z.object({ name: z.string() })) }))
				.optional(),
		});
		expect(requestSchema.parse(h.requests[0]).tools).toBeDefined();
		const selected = requestSchema
			.parse(h.requests[1])
			.tools?.flatMap((group) =>
				group.functionDeclarations.map((declaration) => declaration.name),
			);
		expect(selected).toContain("source_read");
		expect(selected).not.toContain("source_evidence");
		expect(requestSchema.parse(h.requests[3]).tools).toBeUndefined();
		const final = z
			.object({ contents: z.array(z.object({ parts: z.array(z.json()) })) })
			.parse(h.requests[3]);
		const requirements = final.contents
			.flatMap((content) => content.parts)
			.flatMap((part) => {
				const checkpoint = z
					.object({
						functionResponse: z.object({
							response: z.object({
								content: z.object({
									status: z.literal("complete"),
									requiredFindings: z.array(
										z.object({ path: z.string(), line: z.number() }),
									),
								}),
							}),
						}),
					})
					.safeParse(part);
				return checkpoint.success
					? checkpoint.data.functionResponse.response.content.requiredFindings
					: [];
			});
		expect(requirements).toEqual([{ path, line: finding.line }]);
	});
	it.each(["review", "judge"] as const)(
		"archives old large %s retrieval payloads without losing tool pairs, original content or continuations",
		async (stage) => {
			const ordinary = { ...chunk, diff: "@@ -1 +1 @@\n-old\n+new" };
			const source = {
				role: "head",
				path,
				revision: "head",
				repositoryFullName: input.repositoryFullName,
				contentHash: null,
			} as const;
			const reads: ReviewSourceCatalog = {
				revisions: [source],
				list: async () => ({
					kind: "page",
					entries: [],
					totalEntries: 0,
					nextCursor: null,
				}),
				search: async () => ({
					kind: "page",
					matches: [],
					scannedSources: 0,
					totalSources: 0,
					nextCursor: null,
					unavailable: [],
				}),
				related: async () => ({
					kind: "page",
					entries: [],
					totalEntries: 0,
					nextCursor: null,
				}),
				read: async () => ({
					kind: "loaded",
					source,
					content: "original-source-".repeat(200),
					totalLines: 2,
					startLine: 1,
					endLine: 1,
					startColumn: 0,
					endColumn: 3200,
					nextRange: { kind: "lines", startLine: 2, lineCount: 1 },
				}),
				recordInvestigation: vi
					.fn<ReviewSourceCatalog["recordInvestigation"]>()
					.mockResolvedValue({
						...source,
						role: "investigation",
						path: "archive/original",
						contentHash: `sha256:${"a".repeat(64)}`,
					}),
			};
			const h = harness([
				...Array.from({ length: 4 }, () =>
					call("source_read", {
						source: { role: "head", path },
						range: { kind: "lines", startLine: 1, lineCount: 1 },
					}),
				),
				response(
					stage === "review"
						? { findings: [], conclusion }
						: {
								judgments: [
									{
										index: 0,
										kind: "approved",
										rationale: "Confirmed against the loaded original",
									},
								],
							},
				),
			]);
			const execution = {
				signal: new AbortController().signal,
				sources: reads,
				recordUsage: () => {},
				recordMetric: () => {},
			};
			const run =
				stage === "review"
					? () => h.service.review(model, input, ordinary, execution)
					: () =>
							h.service.judge(
								model,
								input,
								{
									candidates: [{ index: 0, evidenceId: "unit", finding }],
									evidence: [
										{
											id: "unit",
											diff: ordinary.diff,
											referenceBefore: "",
											referenceAfter: "",
											investigation: {
												kind: "verified",
												context: "not_enabled",
												exchanges: [],
												conclusion,
											},
										},
									],
								},
								execution,
							);
			await run();
			expect(reads.recordInvestigation).toHaveBeenCalledWith(
				"review_transcript",
				expect.any(String),
				expect.stringContaining("original-source-"),
				expect.any(AbortSignal),
			);
			const final = JSON.stringify(h.requests.at(-1));
			expect(final).toContain("archived_tool_result");
			expect(final).toContain("archive/original");
			const contents = z
				.object({
					contents: z.array(z.object({ role: z.string(), parts: z.array(z.json()) })),
				})
				.parse(h.requests.at(-1)).contents;
			const archivedResponses = contents
				.flatMap((entry) => entry.parts)
				.flatMap((part) => {
					const parsed = z
						.object({
							functionResponse: z.object({
								response: z.object({
									content: z.object({
										kind: z.literal("archived_tool_result"),
										source: z.object({
											role: z.literal("investigation"),
											path: z.literal("archive/original"),
										}),
										range: z.object({
											kind: z.literal("lines"),
											startLine: z.literal(1),
											lineCount: z.literal(1),
										}),
										originalRetrieval: z.object({
											source: z.object({
												role: z.literal("head"),
												path: z.literal(path),
											}),
											nextRange: z.object({
												kind: z.literal("lines"),
												startLine: z.literal(2),
												lineCount: z.literal(1),
											}),
										}),
									}),
								}),
							}),
						})
						.safeParse(part);
					return parsed.success ? [parsed.data.functionResponse.response.content] : [];
				});
			expect(archivedResponses).toHaveLength(2);
			expect(
				contents
					.flatMap((entry) => entry.parts)
					.filter(
						(part) =>
							typeof part === "object" &&
							part !== null &&
							!Array.isArray(part) &&
							"functionCall" in part,
					),
			).toHaveLength(4);
			expect(
				contents
					.flatMap((entry) => entry.parts)
					.filter(
						(part) =>
							typeof part === "object" &&
							part !== null &&
							!Array.isArray(part) &&
							"functionResponse" in part,
					),
			).toHaveLength(4);
		},
	);
});
