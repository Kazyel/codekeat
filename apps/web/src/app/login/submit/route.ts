import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDashboardSession } from "../../lib/api-client";
import { loginAttemptLimiter } from "../../lib/login-attempt-limiter";
import { sessionCookieOptions, sessionCookies } from "../../lib/session";

const credentialsSchema = z.object({
	email: z.string().trim().toLowerCase().email(),
	password: z.string().min(8).max(256),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
	const formData = await request.formData();
	const parsed = credentialsSchema.safeParse({
		email: formData.get("email"),
		password: formData.get("password"),
	});
	if (!parsed.success) {
		return redirectToInvalidCredentials(request);
	}

	if (!loginAttemptLimiter.allows(parsed.data.email, Date.now())) {
		return redirectToInvalidCredentials(request);
	}

	const session = await createDashboardSession(parsed.data.email, parsed.data.password);
	if (session === null) {
		loginAttemptLimiter.recordFailure(parsed.data.email, Date.now());
		return redirectToInvalidCredentials(request);
	}

	loginAttemptLimiter.clear(parsed.data.email);
	const response = NextResponse.redirect(new URL("/dashboard", request.url));
	response.cookies.set(sessionCookies.session, session.token, sessionCookieOptions());
	return response;
}

function redirectToInvalidCredentials(request: NextRequest): NextResponse {
	return NextResponse.redirect(new URL("/login?error=invalid_credentials", request.url));
}
