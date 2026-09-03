import { z } from "zod";

import { loadDashboardEnvironment } from "./environment";

const findingSchema = z.object({
	id: z.string().uuid(),
	severity: z.enum(["critical", "high", "medium", "low"]),
	path: z.string(),
	line: z.number().int().positive(),
	title: z.string(),
	rationale: z.string(),
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

export type DashboardFinding = z.infer<typeof findingSchema>;
export type DashboardReviewRunSummary = z.infer<typeof reviewRunSummarySchema>;
export type DashboardReviewRunDetail = z.infer<typeof reviewRunDetailSchema>;
export type DashboardUser = z.infer<typeof dashboardUserSchema>;
export type DashboardSession = z.infer<typeof dashboardSessionSchema>;

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
	readonly method?: "DELETE" | "GET" | "POST";
	readonly body?: string;
	readonly allowNotFound?: boolean;
}

async function requestCodekeat(path: string, options: RequestOptions = {}): Promise<Response> {
	const environment = loadDashboardEnvironment(process.env);
	const response = await fetch(new URL(path, environment.codekeatApiUrl), {
		headers: {
			authorization: `Bearer ${environment.dashboardApiToken}`,
			"content-type": "application/json",
		},
		method: options.method,
		body: options.body,
		cache: "no-store",
	});

	if (
		response.ok ||
		(options.allowNotFound === true && response.status === 404) ||
		response.status === 401
	) {
		return response;
	}
	throw new Error(`Codekeat API request failed with status ${response.status}.`);
}
