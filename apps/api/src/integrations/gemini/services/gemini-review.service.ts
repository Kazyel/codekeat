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
	reviewConclusionSchema,
	type ReviewConclusion,
	type ReviewContextFile,
	type ReviewContextExchange,
	type ReviewSourceRevision,
	ReviewSourceCoverageIncomplete,
	type ReviewTokenUsage,
} from "#features/review";

import { MAXIMUM_REMOTE_MCP_CALLS } from "../constants/gemini.constants.js";
import { ReviewContextTool } from "../utils/review-context-tool.util.js";
import {
	ReviewSourceTools,
	type ReviewRequiredSourceRead,
} from "../utils/review-source-tools.util.js";
import {
	beginModelCall,
	observeModelPreparation,
	withReviewModelMetrics,
	withReviewUsageMetrics,
} from "../utils/review-model-metrics.util.js";
import {
	createReviewPrompt,
	createJudgePrompt,
	createReviewSystemPrompt,
	createJudgeSystemPrompt,
	createReferenceJudgePrompt,
	createReferenceReviewPrompt,
	type ReviewPromptContext,
	reviewInlineContextFiles,
} from "../utils/review-prompts.util.js";
import { ReviewUsageRecorder } from "../utils/review-usage-recorder.util.js";
import { ReviewContextCapacityExceeded } from "./google-context-capacity.service.js";
import {
	ReviewInvestigationState,
	independentDiscoveryReason,
	mergeIndependentInvestigation,
	validateReviewConclusion,
	validateReviewCheckpoint,
} from "../utils/review-investigation.util.js";
import { ReviewTranscript } from "../utils/review-transcript.util.js";

const TAKEAT_GITHUB_ACCOUNT_LOGIN = "takeatgd";
const GOOGLE_OPTIONS = {
	thinkingConfig: { thinkingLevel: "high" },
} satisfies GoogleLanguageModelOptions;

const REVIEW_RESPONSE_SCHEMA = z
	.object({
		conclusion: reviewConclusionSchema,
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
		const usage = new ReviewUsageRecorder(model, "review", withReviewUsageMetrics(execution));
		if (input.githubInstallationAccountLogin.toLowerCase() !== TAKEAT_GITHUB_ACCOUNT_LOGIN) {
			return this.reviewWithContext(model, input, chunk, "not_enabled", usage, execution);
		}

		try {
			return await this.reviewWithContext(
				model,
				input,
				chunk,
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
		return this.reviewWithContext(model, input, chunk, "unavailable", usage, execution);
	}

	private async reviewWithContext(
		model: ReviewModelConfiguration,
		input: ReviewInput,
		chunk: ReviewInputChunk,
		context: TakeatMcpContextSource | "unavailable" | "not_enabled",
		usage: ReviewUsageRecorder,
		execution: ReviewExecution,
	): Promise<ReviewModelResult> {
		const kind = typeof context === "string" ? context : "available";
		const generate = (discoveryReason: string | null): Promise<ReviewModelResult> =>
			withCatalogFallback(
				(mode) =>
					this.generateReview(
						model,
						(signal) => reviewPrompt(input, chunk, kind, mode, execution, signal),
						context,
						usage,
						execution,
						input,
						chunk,
						discoveryReason,
					),
				execution,
			);
		const first = await generate(null);
		const reason = independentDiscoveryReason(chunk, first);
		if (reason === null) return first;
		const second = await generate(reason);
		return {
			findings: second.findings,
			investigation: mergeIndependentInvestigation(first.investigation, second.investigation),
			usage: usage.snapshot(),
		};
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
		const usage = new ReviewUsageRecorder(model, "judge", withReviewUsageMetrics(execution));
		try {
			const result = await withCatalogFallback(
				(mode) =>
					withReviewModelMetrics(execution, "judge", () =>
						runModelRequest(async (signal) => {
							const sources = createSourceTools(execution, signal);
							const { packet, options } = await observeModelPreparation(
								signal,
								async () => ({
									packet: await judgePrompt(
										input,
										batch,
										mode,
										execution,
										signal,
									),
									options: await prepareInvestigation(
										null,
										sources,
										usage,
										null,
										execution.sources,
										signal,
									),
								}),
							);
							let stepNumber = 0;
							const result = await generateText({
								abortSignal: signal,
								onLanguageModelCallStart: (event) => beginModelCall(event.callId),
								onLanguageModelCallEnd: (event) =>
									usage.record({ ...event, stepNumber }),
								system: createJudgeSystemPrompt(),
								model: this.provider(model.apiName),
								prompt: packet.prompt,
								output: Output.object({ schema: JUDGE_RESPONSE_SCHEMA }),
								seed: 1,
								temperature: 0,
								providerOptions: { google: GOOGLE_OPTIONS },
								...options,
								prepareStep: (args) => {
									stepNumber = args.stepNumber;
									return options.prepareStep(args);
								},
								stopWhen: isStepCount(investigationRounds(sources) + 1),
							});
							sources?.throwIfFailed();
							sources?.assertCoverage(packet.required);
							return result;
						}, execution.signal),
					),
				execution,
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
		preparePrompt: (signal: AbortSignal) => Promise<PreparedReviewPrompt>,
		context: TakeatMcpContextSource | "unavailable" | "not_enabled",
		usage: ReviewUsageRecorder,
		execution: ReviewExecution,
		input: ReviewInput,
		chunk: ReviewInputChunk,
		discoveryReason: string | null,
	): Promise<ReviewModelResult> {
		return withReviewModelMetrics(execution, "review", () =>
			runModelRequest(async (signal) => {
				const investigation = createInvestigation(context, signal, execution);
				const recorder = typeof investigation === "string" ? null : investigation;
				const sources = createSourceTools(execution, signal);
				const evidence = reviewEvidenceContext(sources, execution.sources);
				let evidenceInput: ReviewInput = {
					...input,
					repositoryContext: { ...input.repositoryContext, files: [] },
				};
				const state = new ReviewInvestigationState((conclusion) =>
					validateReviewCheckpoint(
						conclusion,
						evidenceInput,
						chunk,
						evidence.exchanges,
						evidence.revisions,
					),
				);
				const { packet, investigationOptions } = await observeModelPreparation(
					signal,
					async () => ({
						packet: await preparePrompt(signal),
						investigationOptions: await prepareInvestigation(
							recorder,
							sources,
							usage,
							state,
							execution.sources,
							signal,
						),
					}),
				);
				evidenceInput = {
					...input,
					repositoryContext: { ...input.repositoryContext, files: packet.inlineFiles },
				};
				let stepNumber = 0;
				try {
					const result = await generateText({
						abortSignal: signal,
						onLanguageModelCallStart: (event) => beginModelCall(event.callId),
						onLanguageModelCallEnd: (event) => usage.record({ ...event, stepNumber }),
						system: createReviewSystemPrompt(),
						model: this.provider(model.apiName),
						prompt: discoveryPrompt(packet.prompt, discoveryReason),
						output: Output.object({ schema: REVIEW_RESPONSE_SCHEMA }),
						seed: 1,
						temperature: 0,
						providerOptions: { google: GOOGLE_OPTIONS },
						...investigationOptions,
						prepareStep: (args) => {
							stepNumber = args.stepNumber;
							return investigationOptions.prepareStep(args);
						},
						stopWhen: isStepCount(investigationRounds(sources) + 1),
					});
					assertInvestigation(recorder, sources, packet.required);
					validateReviewConclusion(
						result.output.conclusion,
						evidenceInput,
						chunk,
						result.output.findings,
						evidence.exchanges,
						evidence.revisions,
					);
					return {
						findings: result.output.findings,
						investigation: describeInvestigation(
							investigation,
							sources,
							result.output.conclusion,
						),
						usage: usage.snapshot(),
					};
				} catch (error) {
					usage.throwIfFailed();
					assertInvestigation(recorder, sources, null);
					throw error;
				}
			}, execution.signal),
		);
	}
}

function reviewEvidenceContext(
	sources: ReviewSourceTools | null,
	catalog: ReviewExecution["sources"],
): {
	readonly exchanges: readonly ReviewContextExchange[];
	readonly revisions: readonly ReviewSourceRevision[];
} {
	return {
		exchanges: sources === null ? [] : sources.exchanges,
		revisions: catalog === null ? [] : catalog.revisions,
	};
}

function discoveryPrompt(prompt: string, reason: string | null): string {
	if (reason === null) return prompt;
	return [
		prompt,
		"Execute uma descoberta independente usando os dados originais. Examine os cenários decisivos e tente refutar possíveis defeitos; nenhum candidato anterior está sendo fornecido.",
		reason,
	].join("\n\n");
}

function createInvestigation(
	context: TakeatMcpContextSource | "unavailable" | "not_enabled",
	signal: AbortSignal,
	execution: ReviewExecution,
): ReviewContextTool | "unavailable" | "not_enabled" {
	return typeof context === "string"
		? context
		: new ReviewContextTool(context, signal, execution.sources);
}

async function prepareInvestigation(
	recorder: ReviewContextTool | null,
	sources: ReviewSourceTools | null,
	usage: ReviewUsageRecorder,
	state: ReviewInvestigationState | null = null,
	catalog: ReviewExecution["sources"] = null,
	signal: AbortSignal = new AbortController().signal,
): Promise<{
	readonly tools: ToolSet | undefined;
	readonly prepareStep: PrepareStepFunction<ToolSet>;
}> {
	const tools = await investigationTools(recorder, sources, state);
	const transcript = new ReviewTranscript(catalog, signal);
	return {
		tools: Object.keys(tools).length === 0 ? undefined : tools,
		prepareStep: async ({ stepNumber, messages }) => {
			assertInvestigationStep(usage, recorder, sources);
			const compacted = await transcript.compact(messages);
			return {
				messages: compacted,
				...investigationToolPolicy(tools, state, stepNumber, sources),
			};
		},
	};
}

async function investigationTools(
	recorder: ReviewContextTool | null,
	sources: ReviewSourceTools | null,
	state: ReviewInvestigationState | null,
): Promise<ToolSet> {
	return Object.assign(
		{},
		recorder === null ? {} : await recorder.tools(),
		sources === null ? {} : sources.tools(),
		state === null ? {} : state.tools(),
	);
}

function assertInvestigationStep(
	usage: ReviewUsageRecorder,
	recorder: ReviewContextTool | null,
	sources: ReviewSourceTools | null,
): void {
	usage.throwIfFailed();
	recorder?.throwIfFailed();
	sources?.throwIfFailed();
}

function investigationToolPolicy(
	tools: ToolSet,
	state: ReviewInvestigationState | null,
	stepNumber: number,
	sources: ReviewSourceTools | null,
): { readonly activeTools: string[]; readonly toolChoice?: "none" } {
	// Reserve the last round for structured output without tools.
	if (stepNumber >= investigationRounds(sources)) return { activeTools: [], toolChoice: "none" };
	const available = Object.keys(tools);
	const activeTools = state === null ? available : [...state.activeTools(available)];
	if (activeTools.length === 0) return { activeTools, toolChoice: "none" };
	return { activeTools };
}

function describeInvestigation(
	context: ReviewContextTool | "unavailable" | "not_enabled",
	sources: ReviewSourceTools | null,
	conclusion: ReviewConclusion,
): ReviewInvestigation {
	return {
		kind: "verified",
		context: typeof context === "string" ? context : "available",
		exchanges: [
			...(typeof context === "string" ? [] : context.exchanges),
			...(sources?.exchanges ?? []),
		],
		conclusion,
	};
}

function defaultExecution(): ReviewExecution {
	return {
		signal: new AbortController().signal,
		recordUsage: () => {},
		sources: null,
		recordMetric: () => {},
	};
}

function createSourceTools(
	execution: ReviewExecution,
	signal: AbortSignal,
): ReviewSourceTools | null {
	return execution.sources === null ? null : new ReviewSourceTools(execution.sources, signal);
}

function investigationRounds(sources: ReviewSourceTools | null): number {
	return sources === null ? MAXIMUM_REMOTE_MCP_CALLS : 12;
}

async function withCatalogFallback<T>(
	request: (mode: ReviewPromptContext) => Promise<T>,
	execution: ReviewExecution,
): Promise<T> {
	try {
		return await request("inline");
	} catch (error) {
		if (!canUseCatalog(error, execution)) throw error;
	}
	try {
		return await request("catalog");
	} catch (error) {
		if (!(error instanceof ReviewContextCapacityExceeded)) throw error;
	}
	return request("references");
}

function canUseCatalog(error: unknown, execution: ReviewExecution): boolean {
	return error instanceof ReviewContextCapacityExceeded && execution.sources !== null;
}

interface PreparedReviewPrompt {
	readonly prompt: string;
	readonly required: ReviewRequiredSourceRead | null;
	readonly inlineFiles: readonly ReviewContextFile[];
}

async function reviewPrompt(
	input: ReviewInput,
	chunk: ReviewInputChunk,
	kind: ReviewInvestigation["kind"],
	mode: ReviewPromptContext,
	execution: ReviewExecution,
	signal: AbortSignal,
): Promise<PreparedReviewPrompt> {
	if (mode !== "references")
		return {
			prompt: createReviewPrompt(input, chunk, kind, mode),
			required: null,
			inlineFiles:
				mode === "inline"
					? reviewInlineContextFiles(input, [...chunk.changedLines.keys()])
					: [],
		};
	if (execution.sources === null)
		throw new ReviewSourceCoverageIncomplete({ reason: "diff_not_read" });
	const content = JSON.stringify({
		title: input.title,
		body: input.body,
		diff: chunk.diff,
		referenceBefore: chunk.referenceBefore,
		referenceAfter: chunk.referenceAfter,
	});
	const source = await execution.sources.recordInvestigation(
		"review_input",
		JSON.stringify({ index: chunk.index }),
		content,
		signal,
	);
	return {
		prompt: createReferenceReviewPrompt(input, chunk, kind, source),
		required: { source, columns: content.length, reason: "diff_not_read" },
		inlineFiles: [],
	};
}

function assertInvestigation(
	recorder: ReviewContextTool | null,
	sources: ReviewSourceTools | null,
	required: ReviewRequiredSourceRead | null,
): void {
	recorder?.throwIfFailed();
	sources?.throwIfFailed();
	sources?.assertCoverage(required);
}

async function judgePrompt(
	input: ReviewInput,
	batch: ReviewFindingJudgeInput,
	mode: ReviewPromptContext,
	execution: ReviewExecution,
	signal: AbortSignal,
): Promise<PreparedReviewPrompt> {
	if (mode !== "references")
		return { prompt: createJudgePrompt(input, batch, mode), required: null, inlineFiles: [] };
	if (execution.sources === null)
		throw new ReviewSourceCoverageIncomplete({ reason: "judge_evidence_not_read" });
	const content = JSON.stringify({ title: input.title, body: input.body, ...batch });
	const source = await execution.sources.recordInvestigation(
		"judge_input",
		JSON.stringify({ indices: batch.candidates.map((candidate) => candidate.index) }),
		content,
		signal,
	);
	return {
		prompt: createReferenceJudgePrompt(input, batch, source),
		required: { source, columns: content.length, reason: "judge_evidence_not_read" },
		inlineFiles: [],
	};
}

function runModelRequest<T>(
	request: (signal: AbortSignal) => Promise<T>,
	parentSignal: AbortSignal,
): Promise<T> {
	return Effect.runPromise(Effect.tryPromise({ try: request, catch: normalizeModelError }), {
		signal: parentSignal,
	});
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
		error instanceof ReviewSourceCoverageIncomplete ||
		error instanceof TakeatMcpUnavailableError ||
		error instanceof ReviewModelResponseError
	);
}

function normalizeOutputError(error: NoObjectGeneratedError): ReviewModelResponseError {
	if (!error.text) return new ReviewModelResponseError("missing_text");
	if (JSONParseError.isInstance(error.cause)) return new ReviewModelResponseError("invalid_json");
	return new ReviewModelResponseError("schema_invalid");
}
