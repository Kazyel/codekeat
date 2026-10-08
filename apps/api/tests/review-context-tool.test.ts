import { describe, expect, it, vi } from "vitest";

import { ReviewModelResponseError } from "#features/review";
import {
	type McpJsonObject,
	type TakeatMcpContextSource,
	TakeatMcpUnavailableError,
} from "#integrations/takeat-mcp";
import { ReviewContextTool } from "../src/integrations/gemini/utils/review-context-tool.util.js";

const ARGS = { repo: "takeat/orders", ref: "head-sha", path: "src/validation.ts" };

function createSource(response: McpJsonObject): TakeatMcpContextSource {
	return {
		listTools: async () => [
			{ name: "read_file", description: "Read code", inputSchema: { type: "object" } },
		],
		callTool: vi.fn<TakeatMcpContextSource["callTool"]>().mockResolvedValue(response),
	};
}

function textResponse(text: string): McpJsonObject {
	return { content: [{ type: "text", text }] };
}

describe("review context tool", () => {
	it("records actual arguments and identical bounded evidence, isolated per attempt", async () => {
		const source = createSource(textResponse("export const schema = required();"));
		const tool = new ReviewContextTool(source);
		const response = await tool.callTool("read_file", ARGS);

		expect(source.callTool).toHaveBeenCalledWith("read_file", ARGS);
		expect(tool.exchanges).toEqual([
			{
				tool: "read_file",
				argumentsJson: JSON.stringify(ARGS),
				responseJson: JSON.stringify(textResponse("export const schema = required();")),
			},
		]);
		expect(JSON.stringify(response)).toBe(tool.exchanges[0]?.responseJson);
		expect(new ReviewContextTool(source).exchanges).toEqual([]);
	});

	it("serializes concurrent calls to bound escaped results and stop fetching after the budget", async () => {
		const source = createSource(textResponse("\\".repeat(30_000)));
		const tool = new ReviewContextTool(source);
		const responses = await Promise.all(
			Array.from({ length: 16 }, (_, index) =>
				tool.callTool("read_file", { ...ARGS, order: index }),
			),
		);

		expect(responses[0]).toMatchObject({ contextStatus: "truncated", sourceStatus: "success" });
		expect(responses.at(-1)).toEqual({
			contextStatus: "unavailable",
			reason: "context_budget_exceeded",
		});
		expect(vi.mocked(source.callTool).mock.calls.length).toBeLessThan(16);
		expect(
			tool.exchanges.reduce(
				(sum, exchange) =>
					sum + exchange.argumentsJson.length + exchange.responseJson.length,
				0,
			),
		).toBeLessThanOrEqual(28_000);
		for (const [index, response] of responses.entries()) {
			expect(JSON.stringify(response)).toBe(tool.exchanges[index]?.responseJson);
			expect(JSON.stringify(response).length).toBeLessThanOrEqual(12_000);
		}
		expect(JSON.parse(tool.exchanges[0]?.argumentsJson ?? "{}")).toMatchObject({ order: 0 });
		await expect(tool.callTool("read_file", ARGS)).rejects.toThrow(ReviewModelResponseError);
	});

	it("preserves tool errors, including their provenance after truncation", async () => {
		const response = {
			error: { content: [{ type: "text", text: "Revision not found" }], isError: true },
		};
		const failed = new ReviewContextTool(createSource(response));
		expect(await failed.callTool("read_file", ARGS)).toEqual(response);

		const oversized = new ReviewContextTool(
			createSource({
				error: { content: [{ type: "text", text: "\\".repeat(20_000) }], isError: true },
			}),
		);
		expect(await oversized.callTool("read_file", ARGS)).toMatchObject({
			contextStatus: "truncated",
			sourceStatus: "error",
		});
	});

	it("omits unsupported binary evidence from both consumers", async () => {
		const tool = new ReviewContextTool(
			createSource({
				content: [{ type: "image", data: "private-image", mimeType: "image/png" }],
			}),
		);
		expect(await tool.callTool("read_file", ARGS)).toEqual({
			contextStatus: "unavailable",
			reason: "unsupported_content",
		});
		expect(tool.exchanges[0]?.responseJson).not.toContain("private-image");
	});

	it("rejects oversized arguments before remote execution", async () => {
		const source = createSource(textResponse("valid"));
		const tool = new ReviewContextTool(source);
		await expect(tool.callTool("read_file", { query: "x".repeat(4_001) })).rejects.toThrow(
			ReviewModelResponseError,
		);
		expect(source.callTool).not.toHaveBeenCalled();
		expect(tool.exchanges).toEqual([]);
	});

	it("retains the first failure and cancels queued calls without fabricating evidence", async () => {
		const source = createSource(textResponse("unused"));
		const outage = new TakeatMcpUnavailableError();
		vi.mocked(source.callTool).mockRejectedValueOnce(outage);
		const tool = new ReviewContextTool(source);
		const results = await Promise.allSettled([
			tool.callTool("read_file", ARGS),
			tool.callTool("read_file", { path: "src/caller.ts" }),
		]);
		expect(results).toEqual([
			{ status: "rejected", reason: outage },
			{ status: "rejected", reason: outage },
		]);
		expect(source.callTool).toHaveBeenCalledTimes(1);
		expect(() => tool.throwIfFailed()).toThrow(outage);
		expect(tool.exchanges).toEqual([]);
	});
});
