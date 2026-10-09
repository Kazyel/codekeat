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
	type PrepareStepFunction,
	type ToolSet,
} from "ai";
import { Effect } from "effect";
import type { Logger } from "pino";
import { z } from "zod";

import { type TakeatMcpContextSource, TakeatMcpUnavailableError } from "#integrations/takeat-mcp";
import type { ReviewModelConfiguration } from "#features/models";
import {
	type ReviewExecution,
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
import {
	createReviewPrompt,
	createJudgePrompt,
	createReviewSystemPrompt,
	createJudgeSystemPrompt,
} from "../utils/review-prompts.util.js";
import { ReviewUsageRecorder } from "../utils/review-usage-recorder.util.js";
import { ReviewContextCapacityExceeded } from "./google-context-capacity.service.js";

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

const MODEL_REQUEST_TIMEOUT_MS = 5 * 60 * 1_000;

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
		execution: ReviewExecution = defaultExecution(),
	): Promise<ReviewModelResult> {
		const usage = new ReviewUsageRecorder(model, "review", execution);
		if (input.githubInstallationAccountLogin.toLowerCase() !== TAKEAT_GITHUB_ACCOUNT_LOGIN) {
			return this.generateReview(
				model,
				createReviewPrompt(input, chunk, "not_enabled"),
				"not_enabled",
				usage,
				execution,
			);
		}

		try {
			return await this.generateReview(
				model,
				createReviewPrompt(input, chunk, "available"),
				this.takeatMcpTool,
				usage,
				execution,
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
			usage,
			execution,
		);
	}

	async judge(
		model: ReviewModelConfiguration,
		input: ReviewInput,
		batch: ReviewFindingJudgeInput,
		execution: ReviewExecution = defaultExecution(),
	): Promise<{
		readonly judgments: readonly ReviewFindingJudgment[];
		readonly usage: ReviewTokenUsage;
	}> {
		const usage = new ReviewUsageRecorder(model, "judge", execution);
		try {
			const result = await runModelRequest(
				(signal) =>
					generateText({
						abortSignal: signal,
						onLanguageModelCallEnd: (event) =>
							usage.record({ ...event, stepNumber: 0 }),
						system: createJudgeSystemPrompt(),
						model: this.provider(model.apiName),
						prompt: createJudgePrompt(input, batch),
						output: Output.object({ schema: JUDGE_RESPONSE_SCHEMA }),
						seed: 1,
						temperature: 0,
						providerOptions: { google: GOOGLE_OPTIONS },
					}),
				execution.signal,
			);
			return {
				judgments: result.output.judgments.map(({ index, ...judgment }) => ({
					index,
					judgment,
				})),
				usage: usage.snapshot(),
			};
		} catch (error) {
			usage.throwIfFailed();
			throw normalizeModelError(error);
		}
	}

	private generateReview(
		model: ReviewModelConfiguration,
		prompt: string,
		context: TakeatMcpContextSource | "unavailable" | "not_enabled",
		usage: ReviewUsageRecorder,
		execution: ReviewExecution,
	): Promise<ReviewModelResult> {
		return runModelRequest(async (signal) => {
			const investigation = createInvestigation(context, signal);
			const recorder = typeof investigation === "string" ? null : investigation;
			let stepNumber = 0;
			const investigationOptions = await prepareInvestigation(recorder, usage);
			try {
				const result = await generateText({
					abortSignal: signal,
					onLanguageModelCallEnd: (event) => usage.record({ ...event, stepNumber }),
					system: createReviewSystemPrompt(),
					model: this.provider(model.apiName),
					prompt,
					output: Output.object({ schema: REVIEW_RESPONSE_SCHEMA }),
					seed: 1,
					temperature: 0,
					providerOptions: { google: GOOGLE_OPTIONS },
					...investigationOptions,
					prepareStep: (args) => {
						stepNumber = args.stepNumber;
						return investigationOptions.prepareStep(args);
					},
					stopWhen: isStepCount(MAXIMUM_REMOTE_MCP_CALLS + 1),
				});
				recorder?.throwIfFailed();
				return {
					findings: result.output.findings,
					investigation: describeInvestigation(investigation),
					usage: usage.snapshot(),
				};
			} catch (error) {
				usage.throwIfFailed();
				recorder?.throwIfFailed();
				throw error;
			}
		}, execution.signal);
	}
}

function createInvestigation(
	context: TakeatMcpContextSource | "unavailable" | "not_enabled",
	signal: AbortSignal,
): ReviewContextTool | "unavailable" | "not_enabled" {
	return typeof context === "string" ? context : new ReviewContextTool(context, signal);
}

async function prepareInvestigation(
	recorder: ReviewContextTool | null,
	usage: ReviewUsageRecorder,
): Promise<{
	readonly tools: ToolSet | undefined;
	readonly prepareStep: PrepareStepFunction<ToolSet>;
}> {
	return {
		tools: await recorder?.tools(),
		prepareStep: ({ stepNumber }) => {
			usage.throwIfFailed();
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

function defaultExecution(): ReviewExecution {
	return { signal: new AbortController().signal, recordUsage: () => {} };
}

function runModelRequest<T>(
	request: (signal: AbortSignal) => Promise<T>,
	parentSignal: AbortSignal,
): Promise<T> {
	return Effect.runPromise(
		Effect.tryPromise({ try: request, catch: normalizeModelError }).pipe(
			Effect.timeoutOrElse({
				duration: MODEL_REQUEST_TIMEOUT_MS,
				orElse: () => Effect.fail(new Error("The review model request timed out.")),
			}),
		),
		{ signal: parentSignal },
	);
}

function normalizeModelError(error: unknown): Error {
	if (isExpectedModelError(error)) return error;
	if (NoObjectGeneratedError.isInstance(error)) return normalizeOutputError(error);
	const issue = [
		{ matches: JSONParseError.isInstance, issue: "invalid_json" },
		{ matches: TypeValidationError.isInstance, issue: "schema_invalid" },
		{ matches: NoOutputGeneratedError.isInstance, issue: "missing_text" },
		{ matches: NoContentGeneratedError.isInstance, issue: "missing_text" },
	] as const;
	const match = issue.find((entry) => entry.matches(error));
	if (match !== undefined) return new ReviewModelResponseError(match.issue);

	return new Error("The review model request failed.");
}

function isExpectedModelError(error: unknown): error is Error {
	return (
		error instanceof ReviewContextCapacityExceeded ||
		error instanceof TakeatMcpUnavailableError ||
		error instanceof ReviewModelResponseError
	);
}

function normalizeOutputError(error: NoObjectGeneratedError): ReviewModelResponseError {
	if (!error.text) return new ReviewModelResponseError("missing_text");
	if (JSONParseError.isInstance(error.cause)) return new ReviewModelResponseError("invalid_json");
	return new ReviewModelResponseError("schema_invalid");
}
