import type { CallableTool } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCKS = vi.hoisted(() => ({
	clientClose: vi.fn(),
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

import { TakeatMcpAccessTokenService, TakeatMcpTool } from "#integrations/takeat-mcp";

const DELEGATE: CallableTool = {
	tool: MOCKS.delegateTool,
	callTool: vi.fn(),
};

describe("TakeatMcpTool authentication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		MOCKS.clientClose.mockResolvedValue(undefined);
		MOCKS.clientConnect.mockResolvedValue(undefined);
		MOCKS.mcpToTool.mockReturnValue(DELEGATE);
	});

	it("renews credentials and retries one failed MCP operation", async () => {
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
		);
		const getAccessToken = vi
			.spyOn(provider, "getAccessToken")
			.mockResolvedValueOnce("expired-token")
			.mockResolvedValueOnce("fresh-token");
		const invalidate = vi.spyOn(provider, "invalidate");
		const tool = new TakeatMcpTool(new URL("https://mcp.takeat.example/mcp"), provider);

		await expect(tool.tool()).resolves.toMatchObject({
			functionDeclarations: [{ name: "search_code" }],
		});

		expect(getAccessToken).toHaveBeenCalledTimes(2);
		expect(invalidate).toHaveBeenCalledOnce();
		expect(MOCKS.clientConnect).toHaveBeenCalledTimes(2);
		expect(MOCKS.clientClose).toHaveBeenCalledOnce();
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
});
