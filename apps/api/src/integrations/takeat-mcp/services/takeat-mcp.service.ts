import {
	type CallableTool,
	type FunctionCall,
	mcpToTool,
	type Part,
	type Tool,
} from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Logger } from "pino";
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
		private readonly logger: Logger,
	) {}

	async tool(): Promise<Tool> {
		const startedAt = performance.now();
		this.logger.info({}, "takeat_mcp.tool_catalog_started");

		try {
			const tool = await this.withAuthenticationRetry((delegate) => delegate.tool());

			this.logger.info(
				{
					durationMs: elapsedMilliseconds(startedAt),
					toolCount: tool.functionDeclarations?.length ?? 0,
				},
				"takeat_mcp.tool_catalog_succeeded",
			);

			return tool;
		} catch (error) {
			this.logger.error(
				{ durationMs: elapsedMilliseconds(startedAt), err: error },
				"takeat_mcp.tool_catalog_failed",
			);
			throw error;
		}
	}

	async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
		const toolNames = functionCalls.map((call) => call.name ?? "unknown");
		const fields = { functionCallCount: functionCalls.length, toolNames };

		if (functionCalls.some((call) => !isAllowedTool(call.name))) {
			this.logger.warn(fields, "takeat_mcp.tool_call_rejected");
			throw new TakeatMcpToolCallRejectedError();
		}

		const startedAt = performance.now();
		this.logger.info(fields, "takeat_mcp.tool_call_started");

		try {
			const result = await this.withAuthenticationRetry((delegate) =>
				delegate.callTool(functionCalls),
			);

			this.logger.info(
				{ durationMs: elapsedMilliseconds(startedAt), ...fields },
				"takeat_mcp.tool_call_succeeded",
			);

			return result;
		} catch (error) {
			this.logger.error(
				{ durationMs: elapsedMilliseconds(startedAt), err: error, ...fields },
				"takeat_mcp.tool_call_failed",
			);
			throw error;
		}
	}

	private async withAuthenticationRetry<T>(
		operation: (delegate: CallableTool) => Promise<T>,
	): Promise<T> {
		try {
			return await operation(await this.getDelegate());
		} catch (error) {
			this.logger.warn({ err: error }, "takeat_mcp.authentication_retry");
			await this.reset();
			this.accessTokenService.invalidate();
		}

		try {
			return await operation(await this.getDelegate());
		} catch (error) {
			this.logger.error({ err: error }, "takeat_mcp.authentication_retry_failed");
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

		const startedAt = performance.now();
		this.logger.info({}, "takeat_mcp.connection_started");

		try {
			await client.connect(transport);
		} catch (error) {
			await closeClient(client);
			this.logger.error(
				{ durationMs: elapsedMilliseconds(startedAt), err: error },
				"takeat_mcp.connection_failed",
			);
			throw new TakeatMcpUnavailableError();
		}

		this.logger.info(
			{ durationMs: elapsedMilliseconds(startedAt) },
			"takeat_mcp.connection_established",
		);

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

function elapsedMilliseconds(startedAt: number): number {
	return Math.round(performance.now() - startedAt);
}
