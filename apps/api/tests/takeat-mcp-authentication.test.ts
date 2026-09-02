import type { CallableTool } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientClose: vi.fn(),
  clientConnect: vi.fn(),
  delegateTool: vi.fn(),
  mcpToTool: vi.fn(),
  transportCreated: vi.fn(),
}));

vi.mock("@google/genai", () => ({ mcpToTool: mocks.mcpToTool }));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    readonly close = mocks.clientClose;
    readonly connect = mocks.clientConnect;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: unknown) {
      mocks.transportCreated(url, options);
    }
  },
}));

import { TakeatMcpAccessTokenProvider, TakeatMcpTool } from "../src/modules/ai/takeat-mcp-tool.js";

const delegate: CallableTool = {
  tool: mocks.delegateTool,
  callTool: vi.fn(),
};

describe("TakeatMcpTool authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientClose.mockResolvedValue(undefined);
    mocks.clientConnect.mockResolvedValue(undefined);
    mocks.mcpToTool.mockReturnValue(delegate);
  });

  it("renews credentials and retries one failed MCP operation", async () => {
    mocks.delegateTool.mockRejectedValueOnce(new Error("Unauthorized")).mockResolvedValueOnce({
      functionDeclarations: [
        {
          name: "search_code",
          description: "Searches code.",
          parametersJsonSchema: { type: "object" },
        },
      ],
    });
    const provider = new TakeatMcpAccessTokenProvider(
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
    expect(mocks.clientConnect).toHaveBeenCalledTimes(2);
    expect(mocks.clientClose).toHaveBeenCalledOnce();
    expect(mocks.transportCreated).toHaveBeenNthCalledWith(
      1,
      new URL("https://mcp.takeat.example/mcp"),
      expect.objectContaining({
        requestInit: { headers: { Authorization: "Bearer expired-token" } },
      }),
    );
    expect(mocks.transportCreated).toHaveBeenNthCalledWith(
      2,
      new URL("https://mcp.takeat.example/mcp"),
      expect.objectContaining({
        requestInit: { headers: { Authorization: "Bearer fresh-token" } },
      }),
    );
  });
});
