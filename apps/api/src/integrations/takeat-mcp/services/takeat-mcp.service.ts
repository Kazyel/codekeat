import {
	type CallableTool,
	type FunctionCall,
	mcpToTool,
	type Part,
	type Tool,
} from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	ALLOWED_TAKEAT_MCP_TOOL_NAMES,
	TAKEAT_MCP_REQUEST_TIMEOUT_MS,
} from "../constants/takeat-mcp.constants.js";
import {
	TakeatMcpToolCallRejectedError,
	TakeatMcpUnavailableError,
} from "../errors/takeat-mcp.errors.js";
import type { TakeatMcpAccessTokenService } from "./takeat-mcp-access-token.service.js";

export class TakeatMcpTool implements CallableTool {
	private client: Client | null = null;
	private currentAccessToken: string | null = null;
	private delegate: CallableTool | null = null;

	constructor(
		private readonly url: URL,
		private readonly accessTokenService: TakeatMcpAccessTokenService,
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
			this.accessTokenService.invalidate();
		}

		try {
			return await operation(await this.getDelegate());
		} catch {
			await this.reset();
			this.accessTokenService.invalidate();
			throw new TakeatMcpUnavailableError();
		}
	}

	private async getDelegate(): Promise<CallableTool> {
		const accessToken = await this.accessTokenService.getAccessToken();
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
		this.delegate = filterTakeatMcpTool(
			mcpToTool(client, { timeout: TAKEAT_MCP_REQUEST_TIMEOUT_MS }),
		);

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
	return name !== undefined && ALLOWED_TAKEAT_MCP_TOOL_NAMES[name] === true;
}

async function closeClient(client: Client): Promise<void> {
	try {
		await client.close();
	} catch {
		// The failed MCP session is already unusable.
	}
}
