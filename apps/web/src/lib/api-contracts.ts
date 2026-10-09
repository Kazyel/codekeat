import { z } from "zod";

const isoDateTimeSchema = z.iso.datetime();
const reviewStatusSchema = z.enum(["queued", "running", "completed", "failed", "ignored"]);
const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const tokenUsageSchema = z.object({
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheTokens: z.number().int().nonnegative(),
	costUsdMicros: z.number().int().nonnegative(),
});

export const dashboardUserSchema = z.object({
	id: z.uuid(),
	email: z.email(),
	role: z.enum(["admin", "member"]),
});

export const sessionResponseSchema = z.object({
	session: z.object({
		token: z.string().min(43).max(64),
		user: dashboardUserSchema,
	}),
});

export const userResponseSchema = z.object({ user: dashboardUserSchema });

export const reviewRunSummarySchema = z.object({
	id: z.uuid(),
	repositoryFullName: z.string().min(1),
	pullRequestNumber: z.number().int().positive(),
	headSha: z.string().min(1),
	trigger: z.enum(["opened", "reopened", "ready_for_review", "synchronize"]),
	status: reviewStatusSchema,
	modelName: z.string().nullable(),
	findingCount: z.number().int().nonnegative(),
	createdAt: isoDateTimeSchema,
	completedAt: isoDateTimeSchema.nullable(),
	usage: tokenUsageSchema.nullable(),
	reviewReportStatus: z.enum(["pending", "publishing", "published", "failed"]).nullable(),
	githubCommentUrl: z.url().nullable(),
	reviewStrategyVersion: z.string().nullable(),
	judgeUsage: tokenUsageSchema.nullable(),
	changedLineCount: z.number().int().nonnegative().nullable(),
	reviewChunkCount: z.number().int().nonnegative().nullable(),
	judgeCallCount: z.number().int().nonnegative().nullable(),
	processingDurationMs: z.number().int().nonnegative().nullable(),
});

const findingSchema = z.object({
	id: z.uuid(),
	severity: severitySchema,
	path: z.string().min(1),
	line: z.number().int().positive(),
	title: z.string().min(1),
	rationale: z.string().min(1),
	judgeVerdict: z.enum(["not_evaluated", "approved", "rejected", "severity_changed"]),
	judgeSeverity: severitySchema.nullable(),
	judgeRationale: z.string().nullable(),
	includedInReport: z.boolean(),
});

export const reviewRunsResponseSchema = z.object({
	reviewRuns: z.array(reviewRunSummarySchema),
});

export const reviewRunResponseSchema = z.object({
	reviewRun: reviewRunSummarySchema.extend({
		policySource: z.enum(["default", "repository"]),
		policyWarningCode: z.string().nullable(),
		ignoreReason: z.string().nullable(),
		errorCode: z.string().nullable(),
		findings: z.array(findingSchema),
	}),
});

const usageSchema = z.object({
	period: z.string().min(1),
	repositoryFullName: z.string().min(1),
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheTokens: z.number().int().nonnegative(),
	costUsdMicros: z.number().int().nonnegative(),
});

export const reviewUsageResponseSchema = z.object({ usage: z.array(usageSchema) });

const qualitySchema = z.object({
	period: z.string().min(1),
	repositoryFullName: z.string().min(1),
	reviewStrategyVersion: z.string().min(1),
	evaluatedFindingCount: z.number().int().nonnegative(),
	approvedFindingCount: z.number().int().nonnegative(),
	rejectedFindingCount: z.number().int().nonnegative(),
	severityChangedFindingCount: z.number().int().nonnegative(),
	acceptedFindingCount: z.number().int().nonnegative(),
	judgeApprovalRateBasisPoints: z.number().int().nonnegative().nullable(),
	acceptedFindingsPerThousandChangedLines: z.number().nonnegative().nullable(),
	changedLineCount: z.number().int().nonnegative(),
	completedRunCount: z.number().int().nonnegative(),
	reviewInputTokens: z.number().int().nonnegative(),
	reviewOutputTokens: z.number().int().nonnegative(),
	reviewCacheTokens: z.number().int().nonnegative(),
	reviewCostUsdMicros: z.number().int().nonnegative(),
	judgeInputTokens: z.number().int().nonnegative(),
	judgeOutputTokens: z.number().int().nonnegative(),
	judgeCacheTokens: z.number().int().nonnegative(),
	judgeCostUsdMicros: z.number().int().nonnegative(),
	judgeCallCount: z.number().int().nonnegative(),
	averageProcessingDurationMs: z.number().int().nonnegative(),
});

export const reviewQualityResponseSchema = z.object({ quality: z.array(qualitySchema) });

const metricCountSchema = z.number().int().nonnegative();
const metricUsageSchema = tokenUsageSchema.extend({ costUsdMicros: z.number().nonnegative() });
const metricPhaseSchema = z.enum([
	"queue",
	"input",
	"prepare",
	"count",
	"generation",
	"tool",
	"judge",
]);
const metricScopeSchema = z.enum(["phase", "operation"]);
const metricIdSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]{1,160}$/)
	.nullable();
const telemetryEventSchema = z
	.object({
		id: z.uuid(),
		reviewRunId: z.uuid(),
		createdAt: isoDateTimeSchema,
		phase: metricPhaseSchema,
		scope: metricScopeSchema,
		attemptId: metricIdSchema,
		callId: metricIdSchema,
		unitId: metricIdSchema,
		durationMs: metricCountSchema,
		outcome: z.enum(["success", "failed", "ignored", "cancelled"]),
		usage: metricUsageSchema.nullable(),
		reasoningTokens: metricCountSchema.nullable().default(null),
		countedInputTokens: metricCountSchema.nullable(),
		diffBytes: metricCountSchema.nullable(),
		sourceBytes: metricCountSchema.nullable(),
		sourceCount: metricCountSchema.nullable(),
		requestCount: metricCountSchema,
		cacheHitCount: metricCountSchema,
		retryCount: metricCountSchema,
		peakRssBytes: metricCountSchema,
		capacityFailure: z.boolean(),
	})
	.strict()
	.refine(
		(event) =>
			event.reasoningTokens === null ||
			(event.usage !== null && event.reasoningTokens <= event.usage.outputTokens),
		{ message: "Reasoning tokens require known output usage." },
	);
const telemetrySummarySchema = z
	.object({
		period: z.string().min(1),
		phase: metricPhaseSchema,
		scope: metricScopeSchema,
		sizeBand: z.enum(["small", "medium", "large", "unknown"]),
		sampleCount: metricCountSchema,
		runCount: metricCountSchema,
		p50DurationMs: metricCountSchema,
		p95DurationMs: metricCountSchema,
		failureCount: metricCountSchema,
		cancelledCount: metricCountSchema,
		ignoredCount: metricCountSchema,
		requestCount: metricCountSchema,
		cacheHitCount: metricCountSchema,
		retryCount: metricCountSchema,
		capacityFailureCount: metricCountSchema,
		peakRssBytes: metricCountSchema,
		knownUsageCount: metricCountSchema,
		knownReasoningCount: metricCountSchema.default(0),
		reasoningTokens: metricCountSchema.nullable().default(null),
		usage: metricUsageSchema.nullable(),
	})
	.strict();
export const reviewTelemetryResponseSchema = z.object({
	events: z.array(telemetryEventSchema),
	nextCursor: z.string().nullable(),
});
export const reviewTelemetrySummaryResponseSchema = z.object({
	days: metricCountSchema,
	summaries: z.array(telemetrySummarySchema),
});

const repositoryConnectionSchema = z.object({
	githubRepositoryId: z.number().int().positive(),
	fullName: z.string().min(1),
	defaultBranch: z.string().nullable(),
	status: z.enum(["active", "removed"]),
	updatedAt: isoDateTimeSchema,
});

export const githubConnectionsResponseSchema = z.object({
	connections: z.array(
		z.object({
			githubInstallationId: z.number().int().positive(),
			accountLogin: z.string().min(1),
			status: z.enum(["active", "suspended", "deleted"]),
			allowedByConfiguration: z.boolean(),
			updatedAt: isoDateTimeSchema,
			repositories: z.array(repositoryConnectionSchema),
		}),
	),
});

export const modelSchema = z.object({
	id: z.uuid(),
	displayName: z.string().min(1).max(100),
	apiName: z.string().regex(/^gemini-[a-z0-9.-]{1,120}$/),
	inputNanoUsdPerToken: z.number().int().nonnegative(),
	cachedInputNanoUsdPerToken: z.number().int().nonnegative(),
	outputNanoUsdPerToken: z.number().int().nonnegative(),
	enabled: z.boolean(),
	selected: z.boolean(),
	createdAt: isoDateTimeSchema,
	updatedAt: isoDateTimeSchema,
});

export const modelsResponseSchema = z.object({ models: z.array(modelSchema) });
export const modelResponseSchema = z.object({ model: modelSchema });
export const modelMutationResponseSchema = z.object({ result: z.literal("updated") });
export const modelSelectionResponseSchema = z.object({ result: z.literal("selected") });

export const loginInputSchema = z.object({
	email: z.email(),
	password: z.string().min(8).max(256),
});

export const analyticsInputSchema = z.object({
	groupBy: z.enum(["day", "week", "month"]),
	repository: z
		.string()
		.regex(/^[^/\s]+\/[^/\s]+$/)
		.optional(),
});

export const reviewDetailInputSchema = z.object({ id: z.uuid() });
export const reviewTelemetryInputSchema = reviewDetailInputSchema.extend({
	cursor: z.string().max(512).optional(),
});

export const modelInputSchema = z.object({
	displayName: z.string().trim().min(1).max(100),
	apiName: z
		.string()
		.trim()
		.regex(/^gemini-[a-z0-9.-]{1,120}$/),
	inputNanoUsdPerToken: z.number().int().nonnegative(),
	cachedInputNanoUsdPerToken: z.number().int().nonnegative(),
	outputNanoUsdPerToken: z.number().int().nonnegative(),
	enabled: z.boolean(),
});

export const modelUpdateInputSchema = modelInputSchema.partial().extend({ id: z.uuid() });
export const modelSelectionInputSchema = z.object({ id: z.uuid() });

export type DashboardUser = z.infer<typeof dashboardUserSchema>;
export type ReviewRunSummary = z.infer<typeof reviewRunSummarySchema>;
export type ReviewRunStatus = z.infer<typeof reviewStatusSchema>;
export type ReviewRunDetail = z.infer<typeof reviewRunResponseSchema>["reviewRun"];
export type ReviewUsage = z.infer<typeof usageSchema>;
export type ReviewQuality = z.infer<typeof qualitySchema>;
export type GitHubConnection = z.infer<
	typeof githubConnectionsResponseSchema
>["connections"][number];
export type Model = z.infer<typeof modelSchema>;
export type ModelInput = z.infer<typeof modelInputSchema>;
export type AnalyticsInput = z.infer<typeof analyticsInputSchema>;
export type ReviewMetricEvent = z.infer<typeof telemetryEventSchema>;
export type ReviewTelemetrySummary = z.infer<typeof telemetrySummarySchema>;
