import { cookies } from "next/headers";

import { type DashboardUser, validateDashboardSession } from "./api-client";

const sessionCookieName = "codekeat_session";

export async function readSession(): Promise<DashboardUser | null> {
	const token = await readSessionToken();
	if (token === null) {
		return null;
	}
	return validateDashboardSession(token);
}

export async function readSessionToken(): Promise<string | null> {
	return (await cookies()).get(sessionCookieName)?.value ?? null;
}

export const sessionCookies = {
	session: sessionCookieName,
};

export function sessionCookieOptions() {
	return {
		httpOnly: true,
		sameSite: "lax" as const,
		secure: process.env.NODE_ENV === "production",
		maxAge: 28_800,
		path: "/",
	};
}
