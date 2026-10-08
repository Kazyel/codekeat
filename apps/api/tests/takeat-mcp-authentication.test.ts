import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	StreamableHTTPError,
	type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pino from "pino";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCKS = vi.hoisted(() => ({
	clientClose: vi.fn<() => Promise<void>>(),
	clientConnect: vi.fn<Client["connect"]>(),
	clientListTools: vi.fn<Client["listTools"]>(),
	clientCallTool: vi.fn<Client["callTool"]>(),
	transportTerminateSession: vi.fn<() => Promise<void>>(),
	transportCreated: vi.fn<(url: URL, options: StreamableHTTPClientTransportOptions) => void>(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class {
		readonly close = MOCKS.clientClose;
		readonly connect = MOCKS.clientConnect;
		readonly listTools = MOCKS.clientListTools;
		readonly callTool = MOCKS.clientCallTool;
	},
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js")
	>()),
	StreamableHTTPClientTransport: class {
		readonly terminateSession = MOCKS.transportTerminateSession;

		constructor(url: URL, options: StreamableHTTPClientTransportOptions) {
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

const LOGGER = pino({ level: "silent" });
const MCP_URL = new URL("https://mcp.takeat.example/mcp");
const SEARCH_TOOL = {
	name: "search_code",
	description: "Searches code.",
	inputSchema: { type: "object" as const },
};
const CALL_RESULT = { content: [{ type: "text" as const, text: "repository context" }] };

describe("TakeatMcpTool", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		MOCKS.clientClose.mockResolvedValue(undefined);
		MOCKS.clientConnect.mockResolvedValue(undefined);
		MOCKS.clientListTools.mockResolvedValue({ tools: [SEARCH_TOOL] });
		MOCKS.clientCallTool.mockResolvedValue(CALL_RESULT);
		MOCKS.transportTerminateSession.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it.each([
		["UnauthorizedError", new UnauthorizedError("private unauthorized response")],
		["HTTP 401", new StreamableHTTPError(401, "private unauthorized response")],
	])("renews credentials once after %s and closes both sessions", async (_name, failure) => {
		MOCKS.clientListTools
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce({ tools: [SEARCH_TOOL] });
		const { source, tokens } = createSource();
		tokens
			.mockReturnValueOnce(Effect.succeed("expired-token"))
			.mockReturnValueOnce(Effect.succeed("fresh-token"));

		await expect(source.listTools()).resolves.toEqual([SEARCH_TOOL]);

		expect(tokens).toHaveBeenCalledTimes(2);
		expect(MOCKS.clientConnect).toHaveBeenCalledTimes(2);
		expect(MOCKS.clientClose).toHaveBeenCalledTimes(2);
		expect(MOCKS.transportCreated).toHaveBeenNthCalledWith(2, MCP_URL, {
			requestInit: { headers: { Authorization: "Bearer fresh-token" } },
		});
	});

	it.each([
		["server error", new StreamableHTTPError(503, "private response")],
		["unclassified message", new Error("Unauthorized: private message")],
	])("does not renew credentials or retry a %s", async (_name, failure) => {
		MOCKS.clientCallTool.mockRejectedValueOnce(failure);
		const { source, tokens } = createSource();
		const error = vi.spyOn(LOGGER, "error");

		await expect(source.callTool("search_code", { query: "private query" })).rejects.toThrow(
			TakeatMcpUnavailableError,
		);

		expect(tokens).toHaveBeenCalledOnce();
		expect(MOCKS.clientCallTool).toHaveBeenCalledOnce();
		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
		expect(JSON.stringify(error.mock.calls)).not.toContain("private");
	});

	it("stops after a second authentication failure and preserves the fallback error class", async () => {
		MOCKS.clientCallTool.mockRejectedValue(new UnauthorizedError());
		const { source, tokens } = createSource();

		await expect(source.callTool("search_code", {})).rejects.toBeInstanceOf(
			TakeatMcpUnavailableError,
		);

		expect(tokens).toHaveBeenCalledTimes(2);
		expect(MOCKS.clientCallTool).toHaveBeenCalledTimes(2);
		expect(MOCKS.clientClose).toHaveBeenCalledTimes(2);
	});

	it("closes the client when connection fails before an operation starts", async () => {
		MOCKS.clientConnect.mockRejectedValueOnce(new Error("connection failed"));
		const { source } = createSource();

		await expect(source.listTools()).rejects.toThrow(TakeatMcpUnavailableError);

		expect(MOCKS.clientListTools).not.toHaveBeenCalled();
		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
	});

	it.each(["blame_file", "delete_repository", "toString"])(
		"rejects %s before requesting credentials or connecting",
		async (name) => {
			const { source, tokens } = createSource();

			await expect(source.callTool(name, { query: "private" })).rejects.toThrow(
				TakeatMcpToolCallRejectedError,
			);

			expect(tokens).not.toHaveBeenCalled();
			expect(MOCKS.clientConnect).not.toHaveBeenCalled();
		},
	);

	it("filters disallowed tools and reads allowed tools from subsequent catalog pages", async () => {
		MOCKS.clientListTools
			.mockResolvedValueOnce({
				tools: [{ ...SEARCH_TOOL, name: "blame_file" }],
				nextCursor: "second-page",
			})
			.mockResolvedValueOnce({ tools: [SEARCH_TOOL] });
		const { source } = createSource();

		await expect(source.listTools()).resolves.toEqual([SEARCH_TOOL]);

		expect(MOCKS.clientListTools).toHaveBeenNthCalledWith(
			2,
			{ cursor: "second-page" },
			expect.objectContaining({
				timeout: 10_000,
				signal: expect.any(AbortSignal),
			}),
		);
		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
	});

	it.each([
		["empty allowlist", { tools: [{ ...SEARCH_TOOL, name: "blame_file" }] }],
		["repeated cursor", { tools: [], nextCursor: "repeated" }],
		["duplicate tool", { tools: [SEARCH_TOOL, SEARCH_TOOL] }],
	])("rejects an unusable catalog with %s", async (_name, page) => {
		MOCKS.clientListTools.mockResolvedValue(page);
		const { source } = createSource();

		await expect(source.listTools()).rejects.toThrow(TakeatMcpUnavailableError);

		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
	});

	it("fails explicitly when catalog pagination exceeds the limit", async () => {
		MOCKS.clientListTools.mockImplementation(async (params) => ({
			tools: [],
			nextCursor: `${params?.cursor ?? "start"}-next`,
		}));
		const { source } = createSource();

		await expect(source.listTools()).rejects.toThrow(TakeatMcpUnavailableError);

		expect(MOCKS.clientListTools).toHaveBeenCalledTimes(20);
		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
	});

	it("returns successful JSON results and wraps tool errors as context", async () => {
		const failedResult = { ...CALL_RESULT, isError: true };
		MOCKS.clientCallTool.mockResolvedValueOnce(CALL_RESULT).mockResolvedValueOnce(failedResult);
		const { source } = createSource();

		await expect(source.callTool("search_code", { query: "ReviewModel" })).resolves.toEqual(
			CALL_RESULT,
		);
		await expect(source.callTool("search_code", { query: "missing" })).resolves.toEqual({
			error: failedResult,
		});

		expect(MOCKS.clientClose).toHaveBeenCalledTimes(2);
	});

	it("rejects non-JSON data at the MCP boundary", async () => {
		MOCKS.clientCallTool.mockResolvedValueOnce({ ...CALL_RESULT, invalid: undefined });
		const { source } = createSource();

		await expect(source.callTool("search_code", {})).rejects.toThrow(TakeatMcpUnavailableError);

		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
	});

	it("terminates the remote session before closing the local connection", async () => {
		const { source } = createSource();

		await expect(source.callTool("search_code", {})).resolves.toEqual(CALL_RESULT);

		expect(MOCKS.transportTerminateSession).toHaveBeenCalledOnce();
		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
		expect(MOCKS.transportTerminateSession.mock.invocationCallOrder[0]).toBeLessThan(
			MOCKS.clientClose.mock.invocationCallOrder[0],
		);
	});

	it("closes locally after failed remote termination without renewing credentials", async () => {
		MOCKS.transportTerminateSession.mockRejectedValueOnce(
			new UnauthorizedError("private termination response"),
		);
		const { source, tokens } = createSource();
		const warn = vi.spyOn(LOGGER, "warn");

		await expect(source.callTool("search_code", {})).resolves.toEqual(CALL_RESULT);

		expect(tokens).toHaveBeenCalledOnce();
		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			{ errorCode: "terminate_failed" },
			"takeat_mcp.session_termination_failed",
		);
		expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
	});

	it("closes locally after the remote termination deadline and preserves the result", async () => {
		vi.useFakeTimers();
		MOCKS.transportTerminateSession.mockImplementationOnce(() => new Promise<void>(() => {}));
		const { source } = createSource();
		const result = source.callTool("search_code", {});

		await vi.advanceTimersByTimeAsync(10_001);

		await expect(result).resolves.toEqual(CALL_RESULT);
		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
	});

	it("bounds cleanup and preserves a completed operation when close hangs", async () => {
		vi.useFakeTimers();
		MOCKS.clientClose.mockImplementationOnce(() => new Promise<void>(() => {}));
		const { source } = createSource();
		const result = source.callTool("search_code", {});

		await vi.advanceTimersByTimeAsync(10_001);

		await expect(result).resolves.toEqual(CALL_RESULT);
	});
});

function createSource(): {
	readonly source: TakeatMcpTool;
	readonly tokens: ReturnType<typeof vi.spyOn<TakeatMcpAccessTokenService, "getAccessToken">>;
} {
	const provider = new TakeatMcpAccessTokenService(
		new URL("https://mcp.takeat.example/oauth/token"),
		"codekeat",
		"client-secret",
		LOGGER,
	);
	const tokens = vi
		.spyOn(provider, "getAccessToken")
		.mockReturnValue(Effect.succeed("access-token"));
	return { source: new TakeatMcpTool(MCP_URL, provider, LOGGER), tokens };
}
