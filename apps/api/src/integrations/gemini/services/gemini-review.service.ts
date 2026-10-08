import type { GoogleProvider, GoogleLanguageModelOptions } from "@ai-sdk/google";
import {
	generateText,
	isStepCount,
	JSONParseError,
	NoContentGeneratedError,
	NoObjectGeneratedError,
	NoOutputGeneratedError,
	Output,
	TypeValidationError,
	type LanguageModelUsage,
	type PrepareStepFunction,
	type ToolSet,
} from "ai";
import type { Logger } from "pino";
import { z } from "zod";

import { type TakeatMcpContextSource, TakeatMcpUnavailableError } from "#integrations/takeat-mcp";
import type { ReviewModelConfiguration } from "#features/models";
import {
	type ReviewFindingJudge,
	type ReviewFindingJudgeInput,
	type ReviewFindingJudgment,
	type ReviewInput,
	type ReviewInputChunk,
	type ReviewInvestigation,
	type ReviewModel,
	type ReviewModelResult,
	ReviewModelResponseError,
	type ReviewTokenUsage,
} from "#features/review";

import { MAXIMUM_REMOTE_MCP_CALLS } from "../constants/gemini.constants.js";
import { ReviewContextTool } from "../utils/review-context-tool.util.js";
import { createReviewPrompt, createJudgePrompt } from "../utils/review-prompts.util.js";

const TAKEAT_GITHUB_ACCOUNT_LOGIN = "takeatgd";
const GOOGLE_OPTIONS = {
	thinkingConfig: { thinkingLevel: "high" },
} satisfies GoogleLanguageModelOptions;

const REVIEW_RESPONSE_SCHEMA = z
	.object({
		findings: z.array(
			z
				.object({
					severity: z.enum(["critical", "high", "medium", "low"]),
					path: z.string().trim().min(1),
					line: z.number().int().positive(),
					title: z.string().trim().min(1),
					rationale: z.string().trim().min(1),
				})
				.strict(),
		),
	})
	.strict();
const JUDGE_RESPONSE_SCHEMA = z
	.object({
		judgments: z.array(
			z.discriminatedUnion("kind", [
				z
					.object({
						index: z.number().int().nonnegative(),
						kind: z.literal("approved"),
						rationale: z.string().trim().min(1),
					})
					.strict(),
				z
					.object({
						index: z.number().int().nonnegative(),
						kind: z.literal("rejected"),
						rationale: z.string().trim().min(1),
					})
					.strict(),
				z
					.object({
						index: z.number().int().nonnegative(),
						kind: z.literal("severity_changed"),
						severity: z.enum(["critical", "high", "medium", "low"]),
						rationale: z.string().trim().min(1),
					})
					.strict(),
			]),
		),
	})
	.strict();

const TOKEN_COUNT_SCHEMA = z.number().int().nonnegative();
const USAGE_SCHEMA = z
	.object({
		inputTokens: TOKEN_COUNT_SCHEMA,
		outputTokens: TOKEN_COUNT_SCHEMA,
		inputTokenDetails: z.object({
			cacheReadTokens: TOKEN_COUNT_SCHEMA.optional().default(0),
		}),
	})
	.refine((usage) => usage.inputTokenDetails.cacheReadTokens <= usage.inputTokens);
const GOOGLE_USAGE_SCHEMA = z
	.object({
		promptTokenCount: TOKEN_COUNT_SCHEMA,
		cachedContentTokenCount: TOKEN_COUNT_SCHEMA.optional().default(0),
		candidatesTokenCount: TOKEN_COUNT_SCHEMA.optional().default(0),
		thoughtsTokenCount: TOKEN_COUNT_SCHEMA.optional().default(0),
		toolUsePromptTokenCount: TOKEN_COUNT_SCHEMA.optional().default(0),
	})
	.refine((usage) => usage.cachedContentTokenCount <= usage.promptTokenCount);

export class GeminiReviewService implements ReviewModel, ReviewFindingJudge {
	constructor(
		private readonly provider: GoogleProvider,
		private readonly takeatMcpTool: TakeatMcpContextSource,
		private readonly logger: Logger,
	) {}

	async review(
		model: ReviewModelConfiguration,
		input: ReviewInput,
		chunk: ReviewInputChunk,
	): Promise<ReviewModelResult> {
		if (input.githubInstallationAccountLogin.toLowerCase() !== TAKEAT_GITHUB_ACCOUNT_LOGIN) {
			return this.generateReview(
				model,
				createReviewPrompt(input, chunk, "not_enabled"),
				"not_enabled",
			);
		}

		try {
			return await this.generateReview(
				model,
				createReviewPrompt(input, chunk, "available"),
				new ReviewContextTool(this.takeatMcpTool),
			);
		} catch (error) {
			if (!(error instanceof TakeatMcpUnavailableError)) throw error;
		}

		this.logger.warn(
			{
				chunkIndex: chunk.index,
				repository: input.repositoryFullName,
				reviewRunId: input.reviewRunId,
			},
			"takeat_mcp.unavailable_using_repository_context",
		);
		return this.generateReview(
			model,
			createReviewPrompt(input, chunk, "unavailable"),
			"unavailable",
		);
	}

	async judge(
		model: ReviewModelConfiguration,
		input: ReviewInput,
		batch: ReviewFindingJudgeInput,
	): Promise<{
		readonly judgments: readonly ReviewFindingJudgment[];
		readonly usage: ReviewTokenUsage;
	}> {
		try {
			const result = await generateText({
				model: this.provider(model.apiName),
				prompt: createJudgePrompt(input, batch),
				output: Output.object({ schema: JUDGE_RESPONSE_SCHEMA }),
				seed: 1,
				temperature: 0,
				providerOptions: { google: GOOGLE_OPTIONS },
			});
			validateStepUsage(result.steps.map((step) => step.usage));
			return {
				judgments: result.output.judgments.map(({ index, ...judgment }) => ({
					index,
					judgment,
				})),
				usage: parseTokenUsage(result.totalUsage, model),
			};
		} catch (error) {
			throw normalizeModelError(error);
		}
	}

	private async generateReview(
		model: ReviewModelConfiguration,
		prompt: string,
		context: ReviewContextTool | "unavailable" | "not_enabled",
	): Promise<ReviewModelResult> {
		const recorder = typeof context === "string" ? null : context;
		const investigationOptions = await prepareInvestigation(recorder);
		try {
			const result = await generateText({
				model: this.provider(model.apiName),
				prompt,
				output: Output.object({ schema: REVIEW_RESPONSE_SCHEMA }),
				seed: 1,
				temperature: 0,
				providerOptions: { google: GOOGLE_OPTIONS },
				...investigationOptions,
				stopWhen: isStepCount(MAXIMUM_REMOTE_MCP_CALLS + 1),
			});
			recorder?.throwIfFailed();
			validateStepUsage(result.steps.map((step) => step.usage));
			return {
				findings: result.output.findings,
				investigation: describeInvestigation(context),
				usage: parseTokenUsage(result.totalUsage, model),
			};
		} catch (error) {
			// Tool exceptions are tool-error results in the AI SDK, including on the final round.
			recorder?.throwIfFailed();
			throw normalizeModelError(error);
		}
	}
}

async function prepareInvestigation(recorder: ReviewContextTool | null): Promise<{
	readonly tools: ToolSet | undefined;
	readonly prepareStep: PrepareStepFunction<ToolSet>;
}> {
	return {
		tools: await recorder?.tools(),
		prepareStep: ({ stepNumber }) => {
			recorder?.throwIfFailed();
			// Reserve the last round for structured output without tools.
			if (stepNumber >= MAXIMUM_REMOTE_MCP_CALLS)
				return { activeTools: [], toolChoice: "none" };
			return {};
		},
	};
}

function describeInvestigation(
	context: ReviewContextTool | "unavailable" | "not_enabled",
): ReviewInvestigation {
	if (typeof context === "string") return { kind: context };
	return { kind: "available", exchanges: context.exchanges };
}

function validateStepUsage(usages: readonly LanguageModelUsage[]): void {
	for (const usage of usages) {
		const raw = GOOGLE_USAGE_SCHEMA.safeParse(usage.raw);
		const normalized = USAGE_SCHEMA.safeParse(usage);
		if (!raw.success || !normalized.success) {
			throw new ReviewModelResponseError("usage_metadata_invalid");
		}
	}
}

function parseTokenUsage(
	usage: LanguageModelUsage,
	model: ReviewModelConfiguration,
): ReviewTokenUsage {
	const parsed = USAGE_SCHEMA.safeParse(usage);
	if (!parsed.success) throw new ReviewModelResponseError("usage_metadata_invalid");
	const { inputTokens, outputTokens } = parsed.data;
	const cacheTokens = parsed.data.inputTokenDetails.cacheReadTokens;
	const costUsdMicros =
		((inputTokens - cacheTokens) * model.inputNanoUsdPerToken +
			cacheTokens * model.cachedInputNanoUsdPerToken +
			outputTokens * model.outputNanoUsdPerToken) /
		1_000;
	return { inputTokens, outputTokens, cacheTokens, costUsdMicros };
}

function normalizeModelError(error: unknown): Error {
	if (NoObjectGeneratedError.isInstance(error)) return normalizeOutputError(error);
	const issue = [
		{ matches: JSONParseError.isInstance, issue: "invalid_json" },
		{ matches: TypeValidationError.isInstance, issue: "schema_invalid" },
		{ matches: NoOutputGeneratedError.isInstance, issue: "missing_text" },
		{ matches: NoContentGeneratedError.isInstance, issue: "missing_text" },
	] as const;
	const match = issue.find((entry) => entry.matches(error));
	if (match !== undefined) return new ReviewModelResponseError(match.issue);
	if (error instanceof ReviewModelResponseError) return error;
	return new Error("The review model request failed.");
}

function normalizeOutputError(error: NoObjectGeneratedError): ReviewModelResponseError {
	if (!error.text) return new ReviewModelResponseError("missing_text");
	if (JSONParseError.isInstance(error.cause)) return new ReviewModelResponseError("invalid_json");
	return new ReviewModelResponseError("schema_invalid");
}
