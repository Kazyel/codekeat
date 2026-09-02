import {
  type CallableTool,
  type FunctionCall,
  mcpToTool,
  type Part,
  type Tool,
} from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

const allowedToolNames: Record<string, true> = {
  get_commit: true,
  get_commit_diff: true,
  list_repos: true,
  read_file: true,
  search_code: true,
  search_commits: true,
};
const requestTimeoutMs = 10_000;
const maximumRefreshSkewMs = 5 * 60 * 1_000;
const accessTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.literal("bearer")),
  expires_in: z.number().int().positive(),
});

export class TakeatMcpUnavailableError extends Error {
  constructor() {
    super("The Takeat MCP server is unavailable.");
  }
}

export class TakeatMcpToolCallRejectedError extends Error {
  constructor() {
    super("The Takeat MCP tool call is not allowed.");
  }
}

export class TakeatMcpAccessTokenProvider {
  private cachedAccessToken: { readonly refreshAt: number; readonly value: string } | null = null;
  private accessTokenRequest: Promise<string> | null = null;

  constructor(
    private readonly tokenUrl: URL,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cachedAccessToken !== null && Date.now() < this.cachedAccessToken.refreshAt) {
      return this.cachedAccessToken.value;
    }

    if (this.accessTokenRequest === null) {
      this.accessTokenRequest = this.requestAccessToken();
    }

    try {
      return await this.accessTokenRequest;
    } finally {
      this.accessTokenRequest = null;
    }
  }

  invalidate(): void {
    this.cachedAccessToken = null;
  }

  private async requestAccessToken(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.tokenUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new TakeatMcpUnavailableError();
    }

    if (!response.ok) {
      throw new TakeatMcpUnavailableError();
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TakeatMcpUnavailableError();
    }

    const result = accessTokenResponseSchema.safeParse(body);
    if (!result.success) {
      throw new TakeatMcpUnavailableError();
    }

    const lifetimeMs = result.data.expires_in * 1_000;
    const refreshSkewMs = Math.min(maximumRefreshSkewMs, lifetimeMs / 5);
    this.cachedAccessToken = {
      refreshAt: Date.now() + lifetimeMs - refreshSkewMs,
      value: result.data.access_token,
    };
    return result.data.access_token;
  }
}

export class TakeatMcpTool implements CallableTool {
  private client: Client | null = null;
  private currentAccessToken: string | null = null;
  private delegate: CallableTool | null = null;

  constructor(
    private readonly url: URL,
    private readonly accessTokenProvider: TakeatMcpAccessTokenProvider,
  ) {}

  async tool(): Promise<Tool> {
    return this.withAuthenticationRetry((delegate) => delegate.tool());
  }

  async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
    if (functionCalls.some((call) => !isAllowedTool(call.name))) {
      throw new TakeatMcpToolCallRejectedError();
    }

    return this.withAuthenticationRetry((delegate) => delegate.callTool(functionCalls));
  }

  private async withAuthenticationRetry<T>(
    operation: (delegate: CallableTool) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(await this.getDelegate());
    } catch {
      await this.reset();
      this.accessTokenProvider.invalidate();
    }

    try {
      return await operation(await this.getDelegate());
    } catch {
      await this.reset();
      this.accessTokenProvider.invalidate();
      throw new TakeatMcpUnavailableError();
    }
  }

  private async getDelegate(): Promise<CallableTool> {
    const accessToken = await this.accessTokenProvider.getAccessToken();
    if (this.delegate !== null && this.currentAccessToken === accessToken) {
      return this.delegate;
    }

    await this.reset();
    const client = new Client({ name: "codekeat", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(this.url, {
      requestInit: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });

    try {
      await client.connect(transport);
    } catch {
      await closeClient(client);
      throw new TakeatMcpUnavailableError();
    }

    this.client = client;
    this.currentAccessToken = accessToken;
    this.delegate = filterTakeatMcpTool(mcpToTool(client, { timeout: requestTimeoutMs }));
    return this.delegate;
  }

  private async reset(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.currentAccessToken = null;
    this.delegate = null;

    if (client !== null) {
      await closeClient(client);
    }
  }
}

export function filterTakeatMcpTool(delegate: CallableTool): CallableTool {
  return {
    async tool(): Promise<Tool> {
      const tool = await delegate.tool();
      const functionDeclarations = tool.functionDeclarations?.filter((declaration) =>
        isAllowedTool(declaration.name),
      );

      if (functionDeclarations === undefined || functionDeclarations.length === 0) {
        throw new TakeatMcpUnavailableError();
      }

      return { ...tool, functionDeclarations };
    },

    async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
      if (functionCalls.some((call) => !isAllowedTool(call.name))) {
        throw new TakeatMcpToolCallRejectedError();
      }
      return delegate.callTool(functionCalls);
    },
  };
}

function isAllowedTool(name: string | undefined): boolean {
  return name !== undefined && allowedToolNames[name] === true;
}

async function closeClient(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // The failed MCP session is already unusable.
  }
}
