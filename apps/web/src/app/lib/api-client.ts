import { z } from "zod";

import { loadDashboardEnvironment } from "./environment";

const findingSchema = z.object({
	id: z.string().uuid(),
	severity: z.enum(["critical", "high", "medium", "low"]),
	path: z.string(),
	line: z.number().int().positive(),
	title: z.string(),
	rationale: z.string(),
	judgeVerdict: z.enum(["not_evaluated", "approved", "rejected", "severity_changed"]),
	judgeSeverity: z.enum(["critical", "high", "medium", "low"]).nullable(),
	judgeRationale: z.string().nullable(),
	includedInReport: z.boolean(),
});

const reviewRunSummarySchema = z.object({
	id: z.string().uuid(),
	repositoryFullName: z.string(),
	pullRequestNumber: z.number().int().positive(),
	headSha: z.string(),
	trigger: z.enum(["opened", "reopened", "ready_for_review", "synchronize"]),
	status: z.enum(["queued", "running", "completed", "failed", "ignored"]),
	modelName: z.string().nullable(),
	findingCount: z.number().int().nonnegative(),
	createdAt: z.string(),
	completedAt: z.string().nullable(),
	usage: z
		.object({
			inputTokens: z.number().int().nonnegative(),
			outputTokens: z.number().int().nonnegative(),
			cacheTokens: z.number().int().nonnegative(),
			costUsdMicros: z.number().int().nonnegative(),
		})
		.nullable(),
	judgeUsage: z
		.object({
			inputTokens: z.number().int().nonnegative(),
			outputTokens: z.number().int().nonnegative(),
			cacheTokens: z.number().int().nonnegative(),
			costUsdMicros: z.number().int().nonnegative(),
		})
		.nullable(),
	reviewStrategyVersion: z.string().nullable(),
	changedLineCount: z.number().int().nonnegative().nullable(),
	reviewChunkCount: z.number().int().nonnegative().nullable(),
	judgeCallCount: z.number().int().nonnegative().nullable(),
	processingDurationMs: z.number().int().nonnegative().nullable(),
	reviewReportStatus: z.enum(["pending", "publishing", "published", "failed"]).nullable(),
	githubCommentUrl: z.string().url().nullable(),
});

const reviewRunDetailSchema = reviewRunSummarySchema.extend({
	policySource: z.enum(["default", "repository"]),
	policyWarningCode: z.string().nullable(),
	ignoreReason: z.string().nullable(),
	errorCode: z.string().nullable(),
	findings: z.array(findingSchema),
});

const reviewRunListSchema = z.object({ reviewRuns: z.array(reviewRunSummarySchema) });
const reviewRunResponseSchema = z.object({ reviewRun: reviewRunDetailSchema });
const reviewQualitySchema = z.object({
	period: z.string(),
	repositoryFullName: z.string(),
	reviewStrategyVersion: z.string(),
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
const reviewQualityResponseSchema = z.object({ quality: z.array(reviewQualitySchema) });
const githubRepositoryConnectionSchema = z.object({
	githubRepositoryId: z.number().int().positive(),
	fullName: z.string(),
	defaultBranch: z.string().nullable(),
	status: z.enum(["active", "removed"]),
	updatedAt: z.string(),
});
const githubConnectionSchema = z.object({
	githubInstallationId: z.number().int().positive(),
	accountLogin: z.string(),
	status: z.enum(["active", "suspended", "deleted"]),
	allowedByConfiguration: z.boolean(),
	updatedAt: z.string(),
	repositories: z.array(githubRepositoryConnectionSchema),
});
const githubConnectionListSchema = z.object({
	connections: z.array(githubConnectionSchema),
});
const dashboardUserSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	role: z.enum(["admin", "member"]),
});
const dashboardSessionSchema = z.object({
	token: z.string().min(43).max(64),
	user: dashboardUserSchema,
});
const dashboardSessionResponseSchema = z.object({ session: dashboardSessionSchema });
const dashboardSessionValidationSchema = z.object({ user: dashboardUserSchema });
const modelSchema = z.object({
	id: z.string().uuid(),
	displayName: z.string(),
	apiName: z.string(),
	inputNanoUsdPerToken: z.number().int().nonnegative(),
	cachedInputNanoUsdPerToken: z.number().int().nonnegative(),
	outputNanoUsdPerToken: z.number().int().nonnegative(),
	enabled: z.boolean(),
	selected: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
const modelListSchema = z.object({ models: z.array(modelSchema) });
const modelResponseSchema = z.object({ model: modelSchema });
const modelMutationResponseSchema = z.object({ result: z.enum(["updated", "selected"]) });

export type DashboardFinding = z.infer<typeof findingSchema>;
export type DashboardReviewRunSummary = z.infer<typeof reviewRunSummarySchema>;
export type DashboardReviewRunDetail = z.infer<typeof reviewRunDetailSchema>;
export type DashboardReviewQuality = z.infer<typeof reviewQualitySchema>;
export type DashboardGitHubConnection = z.infer<typeof githubConnectionSchema>;
export type DashboardUser = z.infer<typeof dashboardUserSchema>;
export type DashboardSession = z.infer<typeof dashboardSessionSchema>;
export type DashboardModel = z.infer<typeof modelSchema>;
export interface DashboardModelInput {
	readonly displayName: string;
	readonly apiName: string;
	readonly inputNanoUsdPerToken: number;
	readonly cachedInputNanoUsdPerToken: number;
	readonly outputNanoUsdPerToken: number;
	readonly enabled: boolean;
}
export type ModelMutationOutcome =
	| "success"
	| "invalid"
	| "unauthorized"
	| "forbidden"
	| "not_found"
	| "conflict";

export async function loadReviewRuns(): Promise<readonly DashboardReviewRunSummary[]> {
	const response = await requestCodekeat("/api/v1/review-runs");
	const parsed = reviewRunListSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new Error("Codekeat review run list response is invalid.");
	}
	return parsed.data.reviewRuns;
}

export async function loadReviewRun(reviewRunId: string): Promise<DashboardReviewRunDetail | null> {
	const response = await requestCodekeat(`/api/v1/review-runs/${reviewRunId}`, {
		allowNotFound: true,
	});
	if (response.status === 404) {
		return null;
	}

	const parsed = reviewRunResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new Error("Codekeat review run response is invalid.");
	}
	return parsed.data.reviewRun;
}

export async function loadReviewQuality(): Promise<readonly DashboardReviewQuality[]> {
	const response = await requestCodekeat("/api/v1/review-quality?groupBy=month");
	const parsed = reviewQualityResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new Error("Codekeat review quality response is invalid.");
	}
	return parsed.data.quality;
}

export async function loadGitHubConnections(): Promise<readonly DashboardGitHubConnection[]> {
	const response = await requestCodekeat("/api/v1/github/connections");
	const parsed = githubConnectionListSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new Error("Codekeat GitHub connections response is invalid.");
	}
	return parsed.data.connections;
}
export async function loadModels(sessionToken: string): Promise<readonly DashboardModel[]> {
	const response = await requestCodekeat("/api/v1/models", { sessionToken });
	const parsed = modelListSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new Error("Codekeat model list response is invalid.");
	}
	return parsed.data.models;
}

export async function createModel(
	sessionToken: string,
	input: DashboardModelInput,
): Promise<ModelMutationOutcome> {
	const response = await requestModelMutation("/api/v1/models", sessionToken, "POST", input);
	if (!response.ok) {
		return modelMutationFailure(response.status);
	}
	if (!modelResponseSchema.safeParse(await response.json()).success) {
		throw new Error("Codekeat model response is invalid.");
	}
	return "success";
}

export async function updateModel(
	sessionToken: string,
	id: string,
	input: Partial<DashboardModelInput>,
): Promise<ModelMutationOutcome> {
	const response = await requestModelMutation(
		`/api/v1/models/${id}`,
		sessionToken,
		"PATCH",
		input,
	);
	return parseModelMutationResponse(response, "updated");
}

export async function selectModel(sessionToken: string, id: string): Promise<ModelMutationOutcome> {
	const response = await requestModelMutation(
		`/api/v1/models/${id}/select`,
		sessionToken,
		"POST",
	);
	return parseModelMutationResponse(response, "selected");
}

export async function createDashboardSession(
	email: string,
	password: string,
): Promise<DashboardSession | null> {
	const response = await requestCodekeat("/api/v1/dashboard/sessions", {
		method: "POST",
		body: JSON.stringify({ email, password }),
	});
	if (response.status === 401) {
		return null;
	}

	const parsed = dashboardSessionResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new Error("Codekeat dashboard session response is invalid.");
	}
	return parsed.data.session;
}

export async function validateDashboardSession(token: string): Promise<DashboardUser | null> {
	const response = await requestCodekeat("/api/v1/dashboard/sessions/validate", {
		method: "POST",
		body: JSON.stringify({ token }),
	});
	if (response.status === 401) {
		return null;
	}

	const parsed = dashboardSessionValidationSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new Error("Codekeat dashboard session validation response is invalid.");
	}
	return parsed.data.user;
}

export async function deleteDashboardSession(token: string): Promise<void> {
	await requestCodekeat("/api/v1/dashboard/sessions", {
		method: "DELETE",
		body: JSON.stringify({ token }),
	});
}

interface RequestOptions {
	readonly method?: "DELETE" | "GET" | "PATCH" | "POST";
	readonly body?: string;
	readonly allowNotFound?: boolean;
	readonly allowedFailureStatuses?: readonly number[];
	readonly sessionToken?: string;
}

async function requestCodekeat(path: string, options: RequestOptions = {}): Promise<Response> {
	const environment = loadDashboardEnvironment(process.env);
	const headers: Record<string, string> = {
		authorization: `Bearer ${environment.dashboardApiToken}`,
		"content-type": "application/json",
	};
	if (options.sessionToken !== undefined) {
		headers["x-dashboard-session"] = options.sessionToken;
	}

	const response = await fetch(new URL(path, environment.codekeatApiUrl), {
		headers,
		method: options.method,
		body: options.body,
		cache: "no-store",
	});

	if (
		response.ok ||
		(options.allowNotFound === true && response.status === 404) ||
		options.allowedFailureStatuses?.includes(response.status) === true ||
		response.status === 401
	) {
		return response;
	}
	throw new Error(`Codekeat API request failed with status ${response.status}.`);
}

async function requestModelMutation(
	path: string,
	sessionToken: string,
	method: "PATCH" | "POST",
	input?: Partial<DashboardModelInput>,
): Promise<Response> {
	return requestCodekeat(path, {
		method,
		body: input === undefined ? undefined : JSON.stringify(input),
		sessionToken,
		allowedFailureStatuses: [400, 403, 404, 409],
	});
}

async function parseModelMutationResponse(
	response: Response,
	expectedResult: "selected" | "updated",
): Promise<ModelMutationOutcome> {
	if (!response.ok) {
		return modelMutationFailure(response.status);
	}
	const parsed = modelMutationResponseSchema.safeParse(await response.json());
	if (!parsed.success || parsed.data.result !== expectedResult) {
		throw new Error("Codekeat model mutation response is invalid.");
	}
	return "success";
}

function modelMutationFailure(status: number): Exclude<ModelMutationOutcome, "success"> {
	if (status === 401) {
		return "unauthorized";
	}
	if (status === 400) {
		return "invalid";
	}
	if (status === 403) {
		return "forbidden";
	}
	if (status === 404) {
		return "not_found";
	}
	return "conflict";
}
