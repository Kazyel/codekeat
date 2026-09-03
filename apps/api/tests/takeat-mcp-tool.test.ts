import type { CallableTool, FunctionCall, Part, Tool } from "@google/genai";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	filterTakeatMcpTool,
	TakeatMcpAccessTokenService,
	TakeatMcpToolCallRejectedError,
	TakeatMcpUnavailableError,
} from "#integrations/takeat-mcp";

const LOGGER = pino({ level: "silent" });

const SEARCH_CODE_CALL: FunctionCall = {
	name: "search_code",
	args: { query: "ReviewModel" },
};

const BLAME_FILE_CALL: FunctionCall = {
	name: "blame_file",
	args: { path: "src/example.ts", repo: "example" },
};

describe("TakeatMcpAccessTokenService", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("shares one request and caches the access token", async () => {
		const logger = pino({ level: "silent" });
		const info = vi.spyOn(logger, "info");
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse("access-token"));
		vi.stubGlobal("fetch", fetchMock);
		const tokenUrl = new URL("https://mcp.takeat.example/oauth/token");
		const provider = new TakeatMcpAccessTokenService(
			tokenUrl,
			"codekeat",
			"client-secret",
			logger,
		);

		const tokens = await Promise.all([provider.getAccessToken(), provider.getAccessToken()]);

		expect(tokens).toEqual(["access-token", "access-token"]);
		await expect(provider.getAccessToken()).resolves.toBe("access-token");
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledWith(tokenUrl, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				grant_type: "client_credentials",
				client_id: "codekeat",
				client_secret: "client-secret",
			}),
			signal: expect.any(AbortSignal),
		});
		expect(info).toHaveBeenCalledWith({}, "takeat_mcp.token_request_started");
		expect(info).toHaveBeenCalledWith(
			{ durationMs: expect.any(Number), expiresInSeconds: 3_600 },
			"takeat_mcp.token_request_succeeded",
		);
	});

	it("renews the token before it expires", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(tokenResponse("first-token"))
			.mockResolvedValueOnce(tokenResponse("second-token"));
		vi.stubGlobal("fetch", fetchMock);
		const provider = new TakeatMcpAccessTokenService(
			new URL("https://mcp.takeat.example/oauth/token"),
			"codekeat",
			"client-secret",
			LOGGER,
		);

		await expect(provider.getAccessToken()).resolves.toBe("first-token");
		vi.setSystemTime(new Date("2026-09-02T12:54:00Z"));
		await expect(provider.getAccessToken()).resolves.toBe("first-token");
		vi.setSystemTime(new Date("2026-09-02T12:56:00Z"));
		await expect(provider.getAccessToken()).resolves.toBe("second-token");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("rejects invalid token responses", async () => {
		const logger = pino({ level: "silent" });
		const error = vi.spyOn(logger, "error");
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ access_token: "access-token", expires_in: "3600" }), {
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const provider = new TakeatMcpAccessTokenService(
			new URL("https://mcp.takeat.example/oauth/token"),
			"codekeat",
			"client-secret",
			logger,
		);

		await expect(provider.getAccessToken()).rejects.toThrow(TakeatMcpUnavailableError);
		expect(error).toHaveBeenCalledWith(
			{
				durationMs: expect.any(Number),
				errorCode: "invalid_response",
				statusCode: 200,
			},
			"takeat_mcp.token_request_failed",
		);
	});
});

describe("filterTakeatMcpTool", () => {
	it("exposes and executes only code and history tools without authorship", async () => {
		const delegate = createDelegate();
		const tool = filterTakeatMcpTool(delegate);

		const definition = await tool.tool();
		expect(definition.functionDeclarations?.map((declaration) => declaration.name)).toEqual([
			"get_commit",
			"get_commit_diff",
			"list_repos",
			"read_file",
			"search_code",
			"search_commits",
		]);

		await expect(tool.callTool([SEARCH_CODE_CALL])).resolves.toEqual([]);
		expect(delegate.callTool).toHaveBeenCalledWith([SEARCH_CODE_CALL]);

		await expect(tool.callTool([BLAME_FILE_CALL])).rejects.toThrow(
			TakeatMcpToolCallRejectedError,
		);
		expect(delegate.callTool).toHaveBeenCalledTimes(1);
	});

	it("rejects an MCP server without any allowed tools", async () => {
		const tool = filterTakeatMcpTool(createDelegate([BLAME_TOOL]));

		await expect(tool.tool()).rejects.toThrow(TakeatMcpUnavailableError);
	});
});

const CODE_AND_HISTORY_TOOLS = [
	{
		name: "get_commit",
		description: "Reads a commit.",
		parametersJsonSchema: { type: "object" },
	},
	{
		name: "get_commit_diff",
		description: "Reads a commit diff.",
		parametersJsonSchema: { type: "object" },
	},
	{
		name: "list_repos",
		description: "Lists repositories.",
		parametersJsonSchema: { type: "object" },
	},
	{ name: "read_file", description: "Reads a file.", parametersJsonSchema: { type: "object" } },
	{
		name: "search_code",
		description: "Searches code.",
		parametersJsonSchema: { type: "object" },
	},
	{
		name: "search_commits",
		description: "Searches commits.",
		parametersJsonSchema: { type: "object" },
	},
];

const BLAME_TOOL = {
	name: "blame_file",
	description: "Returns file authorship.",
	parametersJsonSchema: { type: "object" },
};

function createDelegate(
	functionDeclarations = [...CODE_AND_HISTORY_TOOLS, BLAME_TOOL],
): CallableTool {
	return {
		tool: vi.fn<() => Promise<Tool>>().mockResolvedValue({ functionDeclarations }),
		callTool: vi.fn<(functionCalls: FunctionCall[]) => Promise<Part[]>>().mockResolvedValue([]),
	};
}

function tokenResponse(accessToken: string): Response {
	return new Response(
		JSON.stringify({
			access_token: accessToken,
			token_type: "Bearer",
			expires_in: 3_600,
		}),
		{ status: 200 },
	);
}
