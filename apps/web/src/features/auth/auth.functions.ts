import { createServerFn } from "@tanstack/react-start";

import { createSession, readCurrentUser, revokeSession } from "./auth.server";
import { loginInputSchema } from "@/lib/api-contracts";

export const getCurrentUserFn = createServerFn({ method: "GET" }).handler(readCurrentUser);

export const loginFn = createServerFn({ method: "POST" })
	.validator(loginInputSchema)
	.handler(async ({ data }) => {
		const user = await createSession(data.email, data.password);
		return user === null
			? { ok: false as const, error: "invalid_credentials" as const }
			: { ok: true as const, user };
	});

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
	await revokeSession();
	return { ok: true as const };
});
