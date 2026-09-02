import type { CallableTool, FunctionCall, Part, Tool } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filterTakeatMcpTool,
  TakeatMcpAccessTokenProvider,
  TakeatMcpToolCallRejectedError,
  TakeatMcpUnavailableError,
} from "../src/modules/ai/takeat-mcp-tool.js";

const searchCodeCall: FunctionCall = {
  name: "search_code",
  args: { query: "ReviewModel" },
};

const blameFileCall: FunctionCall = {
  name: "blame_file",
  args: { path: "src/example.ts", repo: "example" },
};

describe("TakeatMcpAccessTokenProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shares one request and caches the access token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse("access-token"));
    vi.stubGlobal("fetch", fetchMock);
    const tokenUrl = new URL("https://mcp.takeat.example/oauth/token");
    const provider = new TakeatMcpAccessTokenProvider(tokenUrl, "codekeat", "client-secret");

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
  });

  it("renews the token before it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("first-token"))
      .mockResolvedValueOnce(tokenResponse("second-token"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TakeatMcpAccessTokenProvider(
      new URL("https://mcp.takeat.example/oauth/token"),
      "codekeat",
      "client-secret",
    );

    await expect(provider.getAccessToken()).resolves.toBe("first-token");
    vi.setSystemTime(new Date("2026-09-02T12:54:00Z"));
    await expect(provider.getAccessToken()).resolves.toBe("first-token");
    vi.setSystemTime(new Date("2026-09-02T12:56:00Z"));
    await expect(provider.getAccessToken()).resolves.toBe("second-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid token responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "access-token", expires_in: "3600" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TakeatMcpAccessTokenProvider(
      new URL("https://mcp.takeat.example/oauth/token"),
      "codekeat",
      "client-secret",
    );

    await expect(provider.getAccessToken()).rejects.toThrow(TakeatMcpUnavailableError);
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

    await expect(tool.callTool([searchCodeCall])).resolves.toEqual([]);
    expect(delegate.callTool).toHaveBeenCalledWith([searchCodeCall]);

    await expect(tool.callTool([blameFileCall])).rejects.toThrow(TakeatMcpToolCallRejectedError);
    expect(delegate.callTool).toHaveBeenCalledTimes(1);
  });

  it("rejects an MCP server without any allowed tools", async () => {
    const tool = filterTakeatMcpTool(createDelegate([blameTool]));

    await expect(tool.tool()).rejects.toThrow(TakeatMcpUnavailableError);
  });
});

const codeAndHistoryTools = [
  { name: "get_commit", description: "Reads a commit.", parametersJsonSchema: { type: "object" } },
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
  { name: "search_code", description: "Searches code.", parametersJsonSchema: { type: "object" } },
  {
    name: "search_commits",
    description: "Searches commits.",
    parametersJsonSchema: { type: "object" },
  },
];

const blameTool = {
  name: "blame_file",
  description: "Returns file authorship.",
  parametersJsonSchema: { type: "object" },
};

function createDelegate(functionDeclarations = [...codeAndHistoryTools, blameTool]): CallableTool {
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
