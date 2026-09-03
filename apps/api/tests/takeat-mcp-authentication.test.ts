import type { CallableTool, FunctionCall } from "@google/genai";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCKS = vi.hoisted(() => ({
	clientClose: vi.fn(),
	delegateCallTool: vi.fn(),
	clientConnect: vi.fn(),
	delegateTool: vi.fn(),
	mcpToTool: vi.fn(),
	transportCreated: vi.fn(),
}));

vi.mock("@google/genai", () => ({ mcpToTool: MOCKS.mcpToTool }));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class {
		readonly close = MOCKS.clientClose;
		readonly connect = MOCKS.clientConnect;
	},
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: class {
		constructor(url: URL, options: unknown) {
			MOCKS.transportCreated(url, options);
		}
	},
}));

import {
	TakeatMcpAccessTokenService,
	TakeatMcpTool,
	TakeatMcpToolCallRejectedError,
	TakeatMcpUnavailableError,
} from "#integrations/takeat-mcp";

const DELEGATE: CallableTool = {
	tool: MOCKS.delegateTool,
	callTool: MOCKS.delegateCallTool,
};

describe("TakeatMcpTool authentication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		MOCKS.clientClose.mockResolvedValue(undefined);
		MOCKS.clientConnect.mockResolvedValue(undefined);
		MOCKS.mcpToTool.mockReturnValue(DELEGATE);
		MOCKS.delegateCallTool.mockResolvedValue([]);
	});

	it("renews credentials and retries one failed MCP operation", async () => {
		const logger = pino({ level: "silent" });
		const info = vi.spyOn(logger, "info");
		const warn = vi.spyOn(logger, "warn");
		MOCKS.delegateTool.mockRejectedValueOnce(new Error("Unauthorized")).mockResolvedValueOnce({
			functionDeclarations: [
				{
					name: "search_code",
					description: "Searches code.",
					parametersJsonSchema: { type: "object" },
				},
			],
		});
		const provider = new TakeatMcpAccessTokenService(
			new URL("https://mcp.takeat.example/oauth/token"),
			"codekeat",
			"client-secret",
			logger,
		);
		const getAccessToken = vi
			.spyOn(provider, "getAccessToken")
			.mockResolvedValueOnce("expired-token")
			.mockResolvedValueOnce("fresh-token");
		const invalidate = vi.spyOn(provider, "invalidate");
		const tool = new TakeatMcpTool(new URL("https://mcp.takeat.example/mcp"), provider, logger);

		await expect(tool.tool()).resolves.toMatchObject({
			functionDeclarations: [{ name: "search_code" }],
		});

		expect(getAccessToken).toHaveBeenCalledTimes(2);
		expect(invalidate).toHaveBeenCalledOnce();
		expect(MOCKS.clientConnect).toHaveBeenCalledTimes(2);
		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			{ err: expect.any(Error) },
			"takeat_mcp.authentication_retry",
		);
		expect(info).toHaveBeenCalledWith({}, "takeat_mcp.connection_started");
		expect(info).toHaveBeenCalledWith(
			{ durationMs: expect.any(Number) },
			"takeat_mcp.connection_established",
		);
		expect(MOCKS.transportCreated).toHaveBeenNthCalledWith(
			1,
			new URL("https://mcp.takeat.example/mcp"),
			expect.objectContaining({
				requestInit: { headers: { Authorization: "Bearer expired-token" } },
			}),
		);
		expect(MOCKS.transportCreated).toHaveBeenNthCalledWith(
			2,
			new URL("https://mcp.takeat.example/mcp"),
			expect.objectContaining({
				requestInit: { headers: { Authorization: "Bearer fresh-token" } },
			}),
		);
	});

	it("logs successful tool calls without their arguments", async () => {
		const logger = pino({ level: "silent" });
		const info = vi.spyOn(logger, "info");
		const provider = new TakeatMcpAccessTokenService(
			new URL("https://mcp.takeat.example/oauth/token"),
			"codekeat",
			"client-secret",
			logger,
		);
		vi.spyOn(provider, "getAccessToken").mockResolvedValue("access-token");
		const tool = new TakeatMcpTool(new URL("https://mcp.takeat.example/mcp"), provider, logger);
		const functionCall: FunctionCall = {
			name: "search_code",
			args: { query: "sensitive repository content" },
		};

		await expect(tool.callTool([functionCall])).resolves.toEqual([]);

		expect(info).toHaveBeenCalledWith(
			{ functionCallCount: 1, toolNames: ["search_code"] },
			"takeat_mcp.tool_call_started",
		);
		expect(info).toHaveBeenCalledWith(
			{
				durationMs: expect.any(Number),
				functionCallCount: 1,
				toolNames: ["search_code"],
			},
			"takeat_mcp.tool_call_succeeded",
		);
	});

	it("logs rejected tool names without their arguments", async () => {
		const logger = pino({ level: "silent" });
		const warn = vi.spyOn(logger, "warn");
		const provider = new TakeatMcpAccessTokenService(
			new URL("https://mcp.takeat.example/oauth/token"),
			"codekeat",
			"client-secret",
			logger,
		);
		const tool = new TakeatMcpTool(new URL("https://mcp.takeat.example/mcp"), provider, logger);

		await expect(
			tool.callTool([{ name: "delete_repository", args: { confirmation: "secret" } }]),
		).rejects.toThrow(TakeatMcpToolCallRejectedError);

		expect(warn).toHaveBeenCalledWith(
			{ functionCallCount: 1, toolNames: ["delete_repository"] },
			"takeat_mcp.tool_call_rejected",
		);
		expect(MOCKS.clientConnect).not.toHaveBeenCalled();
	});

	it("logs the terminal error after retrying a failed tool call", async () => {
		const firstError = new Error("first failure");
		const terminalError = new Error("terminal failure");
		MOCKS.delegateCallTool
			.mockRejectedValueOnce(firstError)
			.mockRejectedValueOnce(terminalError);
		const logger = pino({ level: "silent" });
		const error = vi.spyOn(logger, "error");
		const provider = new TakeatMcpAccessTokenService(
			new URL("https://mcp.takeat.example/oauth/token"),
			"codekeat",
			"client-secret",
			logger,
		);
		vi.spyOn(provider, "getAccessToken")
			.mockResolvedValueOnce("first-token")
			.mockResolvedValueOnce("second-token");
		const tool = new TakeatMcpTool(new URL("https://mcp.takeat.example/mcp"), provider, logger);

		await expect(
			tool.callTool([{ name: "search_code", args: { query: "private query" } }]),
		).rejects.toThrow(TakeatMcpUnavailableError);

		expect(error).toHaveBeenCalledWith(
			{ err: terminalError },
			"takeat_mcp.authentication_retry_failed",
		);
		expect(error).toHaveBeenCalledWith(
			{
				durationMs: expect.any(Number),
				err: expect.any(TakeatMcpUnavailableError),
				functionCallCount: 1,
				toolNames: ["search_code"],
			},
			"takeat_mcp.tool_call_failed",
		);
	});
});
