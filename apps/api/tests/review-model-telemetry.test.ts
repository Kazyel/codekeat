import { createGoogle } from "@ai-sdk/google";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
	ReviewExecution,
	ReviewInput,
	ReviewMetric,
	ReviewUsageEvent,
} from "#features/review";
import { createGoogleContextCapacityFetch, GeminiReviewService } from "#integrations/gemini";
import { TakeatMcpUnavailableError, type TakeatMcpContextSource } from "#integrations/takeat-mcp";

const model = {
	id: "01991700-0000-7000-8000-000000000038",
	apiName: "gemini-3.8-flash",
	inputNanoUsdPerToken: 750,
	cachedInputNanoUsdPerToken: 75,
	outputNanoUsdPerToken: 3_750,
};
const chunk = {
	changedLines: new Map([["file.ts", new Set([1])]]),
	diff: "@@ -1 +1 @@\n-old\n+new",
	referenceBefore: "",
	referenceAfter: "",
	index: 1,
	total: 1,
};
const input: ReviewInput = {
	baseSha: "base",
	body: "Review the changed contract",
	chunks: [chunk],
	headSha: "head",
	githubInstallationAccountLogin: "TakeatGD",
	pullRequestNumber: 1,
	repositoryFullName: "takeat/example",
	reviewRunId: "run",
	repositoryContext: {
		repositoryFullName: "takeat/example",
		revision: "head",
		files: [{ kind: "loaded", path: "file.ts", content: "new" }],
		omittedFileCount: 0,
	},
	title: "Update contract",
};
const expectedUsage = {
	inputTokens: 100,
	outputTokens: 12,
	cacheTokens: 20,
	costUsdMicros: 106.5,
};
const providerUsage = {
	promptTokenCount: 100,
	cachedContentTokenCount: 20,
	candidatesTokenCount: 10,
	thoughtsTokenCount: 2,
};

const conclusion = {
	status: "complete",
	reviewedPaths: ["file.ts"],
	hypotheses: [
		{
			path: "file.ts",
			line: 1,
			scenario: "Valid caller input",
			expectedBehavior: "Preserve contract",
			observedBehavior: "Contract preserved",
			outcome: "refuted",
			evidence: [
				{ path: "file.ts", role: "head", revision: "head", startLine: 1, endLine: 1 },
			],
			missingEvidence: [],
		},
	],
};
function response(output: string, withUsage = true): Response {
	const value = z.record(z.string(), z.json()).parse(JSON.parse(output));
	if ("findings" in value) output = JSON.stringify({ conclusion, ...value });
	return Response.json({
		candidates: [
			{ content: { role: "model", parts: [{ text: output }] }, finishReason: "STOP" },
		],
		...(withUsage ? { usageMetadata: providerUsage } : {}),
	});
}

function fixture(responses: readonly Response[]) {
	const metrics: ReviewMetric[] = [];
	const usage: ReviewUsageEvent[] = [];
	const queue = [...responses];
	const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
		if (url.toString().endsWith(":countTokens")) return Response.json({ totalTokens: 1 });
		if (!url.toString().endsWith(":generateContent"))
			return Response.json({ inputTokenLimit: 100_000 });
		const result = queue.shift();
		if (result === undefined) throw new Error("Unexpected generation");
		return result;
	});
	const source = {
		listTools: vi.fn<TakeatMcpContextSource["listTools"]>().mockResolvedValue([]),
		callTool: vi.fn<TakeatMcpContextSource["callTool"]>(),
	};
	const service = new GeminiReviewService(
		createGoogle({ apiKey: "test", fetch: createGoogleContextCapacityFetch(fetcher, "test") }),
		source,
		pino({ level: "silent" }),
	);
	const execution: ReviewExecution = {
		signal: new AbortController().signal,
		sources: null,
		recordUsage: (event) => usage.push(event),
		recordMetric: (event) => metrics.push(event),
	};
	return { metrics, usage, execution, service, source };
}

describe("review model telemetry through the guarded SDK transport", () => {
	it("emits each charged step before tools without merging sequential steps in one SDK call", async () => {
		const harness = fixture([
			Response.json({
				candidates: [
					{
						content: {
							role: "model",
							parts: [
								{
									functionCall: { name: "read", args: {} },
									thoughtSignature: "signature",
								},
							],
						},
						finishReason: "STOP",
					},
				],
				usageMetadata: providerUsage,
			}),
			response(JSON.stringify({ findings: [] })),
		]);
		harness.source.listTools.mockResolvedValue([
			{
				name: "read",
				description: "Read evidence",
				inputSchema: { type: "object", properties: {}, additionalProperties: false },
			},
		]);
		let metricsBeforeTool: readonly ReviewMetric[] = [];
		harness.source.callTool.mockImplementation(async () => {
			metricsBeforeTool = harness.metrics.filter((metric) => metric.phase === "generation");
			return { content: [{ type: "text", text: "Confirmed evidence" }] };
		});
		await harness.service.review(model, input, chunk, harness.execution);
		expect(metricsBeforeTool).toEqual([
			expect.objectContaining({ callId: harness.usage[0]?.callId, usage: expectedUsage }),
		]);
		const transport = harness.metrics.filter((metric) => metric.phase === "generation");
		expect(transport.map((metric) => metric.callId)).toEqual(
			harness.usage.map((event) => event.callId),
		);
		expect(harness.usage.map((event) => event.stepNumber)).toEqual([0, 1]);
		expect(transport.map((metric) => metric.usage)).toEqual([expectedUsage, expectedUsage]);
	});
	it.each(["review", "judge"] as const)(
		"attaches validated usage to the single %s transport duration and measures preparation",
		async (stage) => {
			const harness = fixture([
				response(JSON.stringify(stage === "review" ? { findings: [] } : { judgments: [] })),
			]);
			if (stage === "review")
				await harness.service.review(model, input, chunk, harness.execution);
			else
				await harness.service.judge(
					model,
					input,
					{ candidates: [], evidence: [] },
					harness.execution,
				);
			const transport = harness.metrics.filter(
				(metric) => metric.phase === (stage === "review" ? "generation" : "judge"),
			);
			expect(transport).toHaveLength(1);
			expect(transport[0]).toMatchObject({
				callId: harness.usage[0]?.callId,
				usage: expectedUsage,
				requestCount: 1,
				outcome: "success",
			});
			expect(harness.metrics.filter((metric) => metric.phase === "prepare")).toEqual([
				expect.objectContaining({ outcome: "success", usage: null, requestCount: 0 }),
			]);
		},
	);

	it("retains successful response duration with unknown usage when provider metadata is invalid", async () => {
		const harness = fixture([response(JSON.stringify({ findings: [] }), false)]);
		await expect(
			harness.service.review(model, input, chunk, harness.execution),
		).rejects.toMatchObject({
			issue: "usage_metadata_invalid",
		});
		expect(harness.metrics.filter((metric) => metric.phase === "generation")).toEqual([
			expect.objectContaining({ outcome: "success", usage: null, requestCount: 1 }),
		]);
		expect(harness.usage).toEqual([]);
	});

	it("measures failed tool preparation and the subsequent fallback independently", async () => {
		const harness = fixture([response(JSON.stringify({ findings: [] }))]);
		harness.source.listTools.mockRejectedValueOnce(new TakeatMcpUnavailableError());
		await harness.service.review(model, input, chunk, harness.execution);
		expect(
			harness.metrics
				.filter((metric) => metric.phase === "prepare")
				.map((metric) => metric.outcome),
		).toEqual(["failed", "success"]);
		expect(harness.metrics.filter((metric) => metric.phase === "generation")).toHaveLength(1);
	});
});
