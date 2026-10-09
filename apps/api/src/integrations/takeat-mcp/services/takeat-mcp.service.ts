import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	StreamableHTTPClientTransport,
	StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect } from "effect";
import type { Logger } from "pino";
import { z } from "zod";

import {
	ALLOWED_TAKEAT_MCP_TOOL_NAMES,
	TAKEAT_MCP_REQUEST_TIMEOUT_MS,
} from "../constants/takeat-mcp.constants.js";
import {
	TakeatMcpToolCallRejectedError,
	TakeatMcpUnavailableError,
} from "../errors/takeat-mcp.errors.js";
import type {
	McpJsonObject,
	TakeatMcpContextSource,
	TakeatMcpToolDefinition,
} from "../types/takeat-mcp.types.js";
import type { TakeatMcpAccessTokenService } from "./takeat-mcp-access-token.service.js";

const MAXIMUM_TOOL_CATALOG_PAGES = 20;
const MCP_JSON_OBJECT_SCHEMA = z.record(z.string(), z.json());
const TOOL_CATALOG_PAGE_SCHEMA = z.object({
	tools: z.array(
		z.object({
			name: z.string().min(1),
			description: z.string().optional().default(""),
			inputSchema: z.object({ type: z.literal("object") }).catchall(z.json()),
		}),
	),
	nextCursor: z.string().min(1).optional(),
});

class McpAuthenticationError extends Error {
	readonly _tag = "McpAuthenticationError";

	constructor() {
		super("The Takeat MCP credentials were rejected.");
	}
}

type McpOperationError = McpAuthenticationError | TakeatMcpUnavailableError;
type McpOperation<T> = (client: Client) => Effect.Effect<T, McpOperationError>;

interface McpSession {
	readonly client: Client;
	readonly transport: StreamableHTTPClientTransport;
}

export class TakeatMcpTool implements TakeatMcpContextSource {
	constructor(
		private readonly url: URL,
		private readonly accessTokenService: TakeatMcpAccessTokenService,
		private readonly logger: Logger,
	) {}

	listTools(signal?: AbortSignal): Promise<readonly TakeatMcpToolDefinition[]> {
		return this.execute("tool_catalog", {}, (client) => readToolCatalog(client), signal);
	}

	async callTool(
		name: string,
		args: McpJsonObject,
		signal?: AbortSignal,
	): Promise<McpJsonObject> {
		const fields = { toolName: name };
		if (!isAllowedTool(name)) {
			this.logger.warn(fields, "takeat_mcp.tool_call_rejected");
			throw new TakeatMcpToolCallRejectedError();
		}
		const parsedArgs = MCP_JSON_OBJECT_SCHEMA.safeParse(args);
		if (!parsedArgs.success) {
			throw new TakeatMcpToolCallRejectedError();
		}
		return this.execute(
			"tool_call",
			fields,
			(client) =>
				mcpRequest((signal) =>
					client.callTool(
						{ name, arguments: parsedArgs.data },
						undefined,
						requestOptions(signal),
					),
				).pipe(Effect.flatMap(parseToolResult)),
			signal,
		);
	}

	private async execute<T>(
		operationName: "tool_catalog" | "tool_call",
		fields: Readonly<Record<string, string>>,
		operation: McpOperation<T>,
		signal?: AbortSignal,
	): Promise<T> {
		const startedAt = performance.now();
		this.logger.info(fields, `takeat_mcp.${operationName}_started`);
		const program = this.withAuthenticationRetry(operation).pipe(
			Effect.tap(() =>
				Effect.sync(() => {
					this.logger.info(
						{ durationMs: Math.round(performance.now() - startedAt), ...fields },
						`takeat_mcp.${operationName}_succeeded`,
					);
				}),
			),
			Effect.tapError(() =>
				Effect.sync(() => {
					this.logger.error(
						{
							durationMs: Math.round(performance.now() - startedAt),
							errorCode: "unavailable",
							...fields,
						},
						`takeat_mcp.${operationName}_failed`,
					);
				}),
			),
		);
		return Effect.runPromise(program, { signal });
	}

	private withAuthenticationRetry<T>(
		operation: McpOperation<T>,
	): Effect.Effect<T, TakeatMcpUnavailableError> {
		return Effect.gen({ self: this }, function* () {
			const accessToken = yield* this.accessTokenService.getAccessToken();
			return yield* this.withSession(accessToken, operation).pipe(
				Effect.catchTag("McpAuthenticationError", () =>
					this.retryAuthentication(accessToken, operation),
				),
			);
		});
	}

	private retryAuthentication<T>(
		rejectedToken: string,
		operation: McpOperation<T>,
	): Effect.Effect<T, TakeatMcpUnavailableError> {
		return Effect.gen({ self: this }, function* () {
			this.logger.warn({}, "takeat_mcp.authentication_retry");
			yield* this.accessTokenService.invalidate(rejectedToken);
			const freshToken = yield* this.accessTokenService.getAccessToken();
			return yield* this.withSession(freshToken, operation).pipe(
				Effect.mapError(() => new TakeatMcpUnavailableError()),
			);
		});
	}

	private withSession<T>(
		accessToken: string,
		operation: McpOperation<T>,
	): Effect.Effect<T, McpOperationError> {
		return Effect.acquireUseRelease(
			Effect.sync(() => ({
				client: new Client({ name: "codekeat", version: "0.0.0" }),
				transport: new StreamableHTTPClientTransport(this.url, {
					requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
				}),
			})),
			(session) => connectClient(session).pipe(Effect.andThen(operation(session.client))),
			(session) =>
				terminateSession(session.transport, this.logger).pipe(
					Effect.ensuring(closeClient(session.client, this.logger)),
				),
		);
	}
}

function readToolCatalog(
	client: Client,
): Effect.Effect<readonly TakeatMcpToolDefinition[], McpOperationError> {
	return Effect.gen(function* () {
		const tools = new Map<string, TakeatMcpToolDefinition>();
		const cursors = new Set<string>();
		let cursor: string | undefined;
		for (let pageIndex = 0; pageIndex < MAXIMUM_TOOL_CATALOG_PAGES; pageIndex += 1) {
			const page = yield* readToolCatalogPage(client, cursor);
			yield* appendAllowedTools(tools, page.tools);
			if (page.nextCursor === undefined) {
				return yield* requireAllowedTools([...tools.values()]);
			}
			if (cursors.has(page.nextCursor)) {
				return yield* Effect.fail(new TakeatMcpUnavailableError());
			}
			cursors.add(page.nextCursor);
			cursor = page.nextCursor;
		}
		return yield* Effect.fail(new TakeatMcpUnavailableError());
	});
}

function appendAllowedTools(
	tools: Map<string, TakeatMcpToolDefinition>,
	page: readonly TakeatMcpToolDefinition[],
): Effect.Effect<void, TakeatMcpUnavailableError> {
	for (const tool of page) {
		if (!isAllowedTool(tool.name)) {
			continue;
		}
		if (tools.has(tool.name)) {
			return Effect.fail(new TakeatMcpUnavailableError());
		}
		tools.set(tool.name, tool);
	}
	return Effect.void;
}

function readToolCatalogPage(
	client: Client,
	cursor: string | undefined,
): Effect.Effect<z.infer<typeof TOOL_CATALOG_PAGE_SCHEMA>, McpOperationError> {
	return mcpRequest((signal) =>
		client.listTools(cursor === undefined ? undefined : { cursor }, requestOptions(signal)),
	).pipe(
		Effect.flatMap((page) => {
			const parsed = TOOL_CATALOG_PAGE_SCHEMA.safeParse(page);
			return parsed.success
				? Effect.succeed(parsed.data)
				: Effect.fail(new TakeatMcpUnavailableError());
		}),
	);
}

function requireAllowedTools(
	tools: readonly TakeatMcpToolDefinition[],
): Effect.Effect<readonly TakeatMcpToolDefinition[], TakeatMcpUnavailableError> {
	return tools.length === 0
		? Effect.fail(new TakeatMcpUnavailableError())
		: Effect.succeed(tools);
}

function parseToolResult(result: unknown): Effect.Effect<McpJsonObject, TakeatMcpUnavailableError> {
	const parsed = MCP_JSON_OBJECT_SCHEMA.safeParse(result);
	if (!parsed.success) {
		return Effect.fail(new TakeatMcpUnavailableError());
	}
	return Effect.succeed(parsed.data.isError === true ? { error: parsed.data } : parsed.data);
}

function connectClient(session: McpSession): Effect.Effect<void, McpOperationError> {
	return mcpRequest((signal) =>
		session.client.connect(session.transport, requestOptions(signal)),
	);
}

function terminateSession(
	transport: StreamableHTTPClientTransport,
	logger: Logger,
): Effect.Effect<void> {
	return Effect.tryPromise({
		try: () => transport.terminateSession(),
		catch: () => new TakeatMcpUnavailableError(),
	}).pipe(
		Effect.interruptible,
		Effect.timeoutOrElse({
			duration: TAKEAT_MCP_REQUEST_TIMEOUT_MS,
			orElse: () => Effect.fail(new TakeatMcpUnavailableError()),
		}),
		Effect.catch(() =>
			Effect.sync(() => {
				logger.warn(
					{ errorCode: "terminate_failed" },
					"takeat_mcp.session_termination_failed",
				);
			}),
		),
	);
}

function closeClient(client: Client, logger: Logger): Effect.Effect<void> {
	return Effect.tryPromise({
		try: () => client.close(),
		catch: () => new TakeatMcpUnavailableError(),
	}).pipe(
		// Resource finalizers are masked; the close itself must remain interruptible for its deadline.
		Effect.interruptible,
		Effect.timeoutOrElse({
			duration: TAKEAT_MCP_REQUEST_TIMEOUT_MS,
			orElse: () => Effect.fail(new TakeatMcpUnavailableError()),
		}),
		Effect.catch(() =>
			Effect.sync(() => {
				logger.warn({ errorCode: "close_failed" }, "takeat_mcp.connection_close_failed");
			}),
		),
	);
}

function mcpRequest<T>(
	request: (signal: AbortSignal) => Promise<T>,
): Effect.Effect<T, McpOperationError> {
	return Effect.tryPromise({ try: request, catch: classifyMcpError }).pipe(
		Effect.timeoutOrElse({
			duration: TAKEAT_MCP_REQUEST_TIMEOUT_MS,
			orElse: () => Effect.fail(new TakeatMcpUnavailableError()),
		}),
	);
}

function classifyMcpError(error: unknown): McpOperationError {
	if (error instanceof UnauthorizedError) {
		return new McpAuthenticationError();
	}
	if (error instanceof StreamableHTTPError && error.code === 401) {
		return new McpAuthenticationError();
	}
	return new TakeatMcpUnavailableError();
}

function requestOptions(signal: AbortSignal): {
	readonly signal: AbortSignal;
	readonly timeout: number;
} {
	return { signal, timeout: TAKEAT_MCP_REQUEST_TIMEOUT_MS };
}

function isAllowedTool(name: string): boolean {
	return Object.hasOwn(ALLOWED_TAKEAT_MCP_TOOL_NAMES, name);
}
