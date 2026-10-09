import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { jsonSchema, tool, type ToolSet } from "ai";
import { Effect, Semaphore } from "effect";
import { z } from "zod";

import { type ReviewContextExchange, ReviewModelResponseError } from "#features/review";
import {
	type McpJsonObject,
	type TakeatMcpContextSource,
	TakeatMcpToolCallRejectedError,
	TakeatMcpUnavailableError,
} from "#integrations/takeat-mcp";

const MAXIMUM_EXCHANGES = 16;
const JSON_OBJECT_SCHEMA = z.record(z.string(), z.json());
const TEXT_CONTENT_SCHEMA = z.object({
	content: z.array(z.object({ type: z.literal("text"), text: z.string() })).optional(),
});
type ContextFailure =
	| ReviewModelResponseError
	| TakeatMcpToolCallRejectedError
	| TakeatMcpUnavailableError;

/** One attempt owns complete, deduplicated evidence and its first failure. */
export class ReviewContextTool {
	private readonly recorded: ReviewContextExchange[] = [];
	private readonly responses = new Map<string, McpJsonObject>();
	private readonly calls = Semaphore.makeUnsafe(1);
	private failure: ContextFailure | null = null;

	constructor(
		private readonly source: TakeatMcpContextSource,
		private readonly signal?: AbortSignal,
	) {}

	get exchanges(): readonly ReviewContextExchange[] {
		return [...this.recorded];
	}

	async tools(): Promise<ToolSet> {
		const definitions = await this.source.listTools(this.signal);
		const validator = new AjvJsonSchemaValidator();
		try {
			return Object.fromEntries(
				definitions.map((definition) => {
					const validate = validator.getValidator<McpJsonObject>(definition.inputSchema);
					return [
						definition.name,
						tool({
							description: definition.description,
							inputSchema: jsonSchema<McpJsonObject>(definition.inputSchema, {
								validate(value) {
									const parsed = JSON_OBJECT_SCHEMA.safeParse(value);
									if (parsed.success && validate(parsed.data).valid) {
										return { success: true, value: parsed.data };
									}
									return {
										success: false,
										error: new Error("Invalid MCP arguments."),
									};
								},
							}),
							execute: (args) => this.callTool(definition.name, args),
						}),
					];
				}),
			);
		} catch {
			throw new ReviewModelResponseError("context_response_invalid");
		}
	}

	throwIfFailed(): void {
		this.signal?.throwIfAborted();
		if (this.failure !== null) throw this.failure;
	}

	callTool(name: string, args: McpJsonObject): Promise<McpJsonObject> {
		// The AI SDK executes calls in parallel. Serialize admission and recording.
		return Effect.runPromise(
			this.calls.withPermit(
				Effect.tryPromise({
					try: () => this.callAndRecord(name, args),
					catch: normalizeContextFailure,
				}).pipe(
					Effect.tapError((error) =>
						Effect.sync(() => {
							this.failure ??= error;
						}),
					),
				),
			),
		);
	}

	private async callAndRecord(name: string, args: McpJsonObject): Promise<McpJsonObject> {
		this.throwIfFailed();
		const argumentsJson = JSON.stringify(args);
		const key = JSON.stringify([name, orderedJson(args)]);
		const cached = this.responses.get(key);
		if (cached !== undefined) return cached;
		if (this.recorded.length >= MAXIMUM_EXCHANGES) {
			throw new ReviewModelResponseError("context_response_invalid");
		}
		const response = readableResponse(await this.source.callTool(name, args, this.signal));
		const responseJson = JSON.stringify(response);
		this.recorded.push({
			tool: name,
			argumentsJson,
			responseJson,
		});
		this.responses.set(key, response);
		return response;
	}
}

function normalizeContextFailure(error: unknown): ContextFailure {
	if (
		error instanceof TakeatMcpUnavailableError ||
		error instanceof TakeatMcpToolCallRejectedError ||
		error instanceof ReviewModelResponseError
	)
		return error;
	return new ReviewModelResponseError("context_response_invalid");
}

function readableResponse(response: McpJsonObject): McpJsonObject {
	const content = "error" in response ? response.error : response;
	if (!TEXT_CONTENT_SCHEMA.safeParse(content).success) {
		return { contextStatus: "unavailable", reason: "unsupported_content" };
	}
	return response;
}

function orderedJson(value: z.JSONType): z.JSONType {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(orderedJson);
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, orderedJson(entry)]),
	);
}
