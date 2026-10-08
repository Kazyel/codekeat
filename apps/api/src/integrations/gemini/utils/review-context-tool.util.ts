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
const MAXIMUM_ARGUMENT_LENGTH = 4_000;
const MAXIMUM_RESPONSE_LENGTH = 12_000;
const MAXIMUM_CONTEXT_LENGTH = 24_000;
const MINIMUM_RESPONSE_LENGTH = 200;
const OMITTED_ARGUMENTS_JSON = JSON.stringify({
	contextStatus: "omitted",
	reason: "context_budget_exceeded",
});
const JSON_OBJECT_SCHEMA = z.record(z.string(), z.json());
const TEXT_CONTENT_SCHEMA = z.object({
	content: z.array(z.object({ type: z.literal("text"), text: z.string() })).optional(),
});
type ContextFailure =
	| ReviewModelResponseError
	| TakeatMcpToolCallRejectedError
	| TakeatMcpUnavailableError;

/** One attempt owns its evidence, budget and first failure. */
export class ReviewContextTool {
	private readonly recorded: ReviewContextExchange[] = [];
	private remainingLength = MAXIMUM_CONTEXT_LENGTH;
	private readonly calls = Semaphore.makeUnsafe(1);
	private failure: ContextFailure | null = null;

	constructor(private readonly source: TakeatMcpContextSource) {}

	get exchanges(): readonly ReviewContextExchange[] {
		return [...this.recorded];
	}

	async tools(): Promise<ToolSet> {
		const definitions = await this.source.listTools();
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
		if (this.failure !== null) throw this.failure;
	}

	callTool(name: string, args: McpJsonObject): Promise<McpJsonObject> {
		// The AI SDK executes calls in parallel. Serialize admission and accounting.
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
		if (
			argumentsJson.length > MAXIMUM_ARGUMENT_LENGTH ||
			this.recorded.length >= MAXIMUM_EXCHANGES
		) {
			throw new ReviewModelResponseError("context_response_invalid");
		}

		const limit = Math.min(
			MAXIMUM_RESPONSE_LENGTH,
			this.remainingLength - argumentsJson.length,
		);
		const exhausted = limit < MINIMUM_RESPONSE_LENGTH;
		const response = exhausted
			? { contextStatus: "unavailable", reason: "context_budget_exceeded" }
			: limitResponse(await this.source.callTool(name, args), limit);
		const responseJson = JSON.stringify(response);
		this.recorded.push({
			tool: name,
			argumentsJson: exhausted ? OMITTED_ARGUMENTS_JSON : argumentsJson,
			responseJson,
		});
		this.remainingLength = Math.max(
			0,
			this.remainingLength - argumentsJson.length - responseJson.length,
		);
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

function limitResponse(response: McpJsonObject, limit: number): McpJsonObject {
	const content = "error" in response ? response.error : response;
	if (!TEXT_CONTENT_SCHEMA.safeParse(content).success) {
		return { contextStatus: "unavailable", reason: "unsupported_content" };
	}
	const serialized = JSON.stringify(response);
	if (serialized.length > limit) {
		return {
			contextStatus: "truncated",
			sourceStatus: "error" in response ? "error" : "success",
			// The JSON prefix is encoded again as a string; each character may double.
			content: serialized.slice(
				0,
				Math.max(0, Math.floor((limit - MINIMUM_RESPONSE_LENGTH) / 2)),
			),
			warning: "Resposta incompleta; não use conteúdo omitido como evidência.",
		};
	}
	return response;
}
