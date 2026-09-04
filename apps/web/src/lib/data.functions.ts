import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { readCurrentUser, readSessionToken } from "@/features/auth/auth.server";
import { ApiError, requestApi } from "@/lib/api.server";
import {
	analyticsInputSchema,
	githubConnectionsResponseSchema,
	modelInputSchema,
	modelMutationResponseSchema,
	modelResponseSchema,
	modelSelectionInputSchema,
	modelSelectionResponseSchema,
	modelsResponseSchema,
	modelUpdateInputSchema,
	reviewDetailInputSchema,
	reviewQualityResponseSchema,
	reviewRunResponseSchema,
	reviewRunsResponseSchema,
	reviewUsageResponseSchema,
	type DashboardUser,
} from "@/lib/api-contracts";

interface ProtectedSession {
	readonly token: string;
	readonly user: DashboardUser;
}

export const getOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireSession();
	const [runs, usage, quality] = await Promise.all([
		requestApi("/api/v1/review-runs", reviewRunsResponseSchema),
		requestApi("/api/v1/review-usage?groupBy=day", reviewUsageResponseSchema),
		requestApi("/api/v1/review-quality?groupBy=day", reviewQualityResponseSchema),
	]);
	return { runs: runs.reviewRuns, usage: usage.usage, quality: quality.quality };
});

export const getReviewRunsFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireSession();
	return (await requestApi("/api/v1/review-runs", reviewRunsResponseSchema)).reviewRuns;
});

export const getReviewDetailFn = createServerFn({ method: "GET" })
	.validator(reviewDetailInputSchema)
	.handler(async ({ data }) => {
		await requireSession();
		return (await requestApi(`/api/v1/review-runs/${data.id}`, reviewRunResponseSchema))
			.reviewRun;
	});

export const getAnalyticsFn = createServerFn({ method: "GET" })
	.validator(analyticsInputSchema)
	.handler(async ({ data }) => {
		await requireSession();
		const query = new URLSearchParams({ groupBy: data.groupBy });
		if (data.repository) query.set("repository", data.repository);
		const [usage, quality] = await Promise.all([
			requestApi(`/api/v1/review-usage?${query}`, reviewUsageResponseSchema),
			requestApi(`/api/v1/review-quality?${query}`, reviewQualityResponseSchema),
		]);
		return { usage: usage.usage, quality: quality.quality };
	});

export const getConnectionsFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireSession();
	return (await requestApi("/api/v1/github/connections", githubConnectionsResponseSchema))
		.connections;
});

export const getModelsFn = createServerFn({ method: "GET" }).handler(async () => {
	const session = await requireSession();
	return (
		await requestApi("/api/v1/models", modelsResponseSchema, {
			sessionToken: session.token,
		})
	).models;
});

export const createModelFn = createServerFn({ method: "POST" })
	.validator(modelInputSchema)
	.handler(async ({ data }) => {
		const session = await requireAdmin();
		try {
			const result = await requestApi("/api/v1/models", modelResponseSchema, {
				method: "POST",
				body: data,
				sessionToken: session.token,
			});
			return { ok: true as const, model: result.model };
		} catch (error) {
			return mutationFailure(error);
		}
	});

export const updateModelFn = createServerFn({ method: "POST" })
	.validator(modelUpdateInputSchema)
	.handler(async ({ data }) => {
		const session = await requireAdmin();
		const { id, ...input } = data;
		try {
			await requestApi(`/api/v1/models/${id}`, modelMutationResponseSchema, {
				method: "PATCH",
				body: input,
				sessionToken: session.token,
			});
			return { ok: true as const };
		} catch (error) {
			return mutationFailure(error);
		}
	});

export const selectModelFn = createServerFn({ method: "POST" })
	.validator(modelSelectionInputSchema)
	.handler(async ({ data }) => {
		const session = await requireAdmin();
		try {
			await requestApi(`/api/v1/models/${data.id}/select`, modelSelectionResponseSchema, {
				method: "POST",
				sessionToken: session.token,
			});
			return { ok: true as const };
		} catch (error) {
			return mutationFailure(error);
		}
	});

async function requireSession(): Promise<ProtectedSession> {
	const [user, token] = await Promise.all([
		readCurrentUser(),
		Promise.resolve(readSessionToken()),
	]);
	if (user === null || token === null) throw redirect({ to: "/login" });
	return { token, user };
}

async function requireAdmin(): Promise<ProtectedSession> {
	const session = await requireSession();
	if (session.user.role !== "admin") throw new ApiError("forbidden", 403);
	return session;
}

function mutationFailure(
	error: unknown,
):
	| { readonly ok: false; readonly error: "conflict" }
	| { readonly ok: false; readonly error: "unavailable" } {
	if (error instanceof ApiError && error.code === "conflict") {
		return { ok: false, error: "conflict" };
	}
	return { ok: false, error: "unavailable" };
}
