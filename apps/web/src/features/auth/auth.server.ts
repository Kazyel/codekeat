import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { requestApi } from "@/lib/api.server";
import {
	type DashboardUser,
	dashboardUserSchema,
	sessionResponseSchema,
	userResponseSchema,
} from "@/lib/api-contracts";
import { LoginRateLimiter } from "@/features/auth/login-rate-limiter";

const SESSION_COOKIE = "codekeat-session";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;

const loginRateLimiter = new LoginRateLimiter(LOGIN_LIMIT, LOGIN_WINDOW_MS);
export function readSessionToken(): string | null {
	return getCookie(SESSION_COOKIE) ?? null;
}

export async function readCurrentUser(): Promise<DashboardUser | null> {
	const token = readSessionToken();
	if (token === null) return null;

	try {
		const response = await requestApi(
			"/api/v1/dashboard/sessions/validate",
			userResponseSchema,
			{
				method: "POST",
				body: { token },
			},
		);
		return dashboardUserSchema.parse(response.user);
	} catch (error) {
		if (!isInvalidSession(error)) throw error;
		clearSessionCookie();
		return null;
	}
}

export async function createSession(
	email: string,
	password: string,
): Promise<DashboardUser | null> {
	const key = email.trim().toLowerCase();
	if (!loginRateLimiter.mayAttempt(key, Date.now())) return null;

	try {
		const response = await requestApi("/api/v1/dashboard/sessions", sessionResponseSchema, {
			method: "POST",
			body: { email: key, password },
		});
		loginRateLimiter.clear(key);
		setCookie(SESSION_COOKIE, response.session.token, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: SESSION_MAX_AGE_SECONDS,
		});
		return response.session.user;
	} catch (error) {
		if (isInvalidSession(error)) {
			loginRateLimiter.recordFailure(key, Date.now());
			return null;
		}
		throw error;
	}
}

export async function revokeSession(): Promise<void> {
	const token = readSessionToken();
	clearSessionCookie();
	if (token === null) return;

	try {
		await requestApi("/api/v1/dashboard/sessions", dashboardUserSchema.optional(), {
			method: "DELETE",
			body: { token },
		});
	} catch {
		// The local cookie is already gone; logout must remain reliable.
	}
}

export function clearSessionCookie(): void {
	deleteCookie(SESSION_COOKIE, { path: "/" });
}

function isInvalidSession(error: unknown): error is { readonly status: 401 } {
	return typeof error === "object" && error !== null && "status" in error && error.status === 401;
}
