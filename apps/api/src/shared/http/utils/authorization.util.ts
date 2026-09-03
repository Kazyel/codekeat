import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function hasValidBearerToken(request: IncomingMessage, token: string): boolean {
	const authorization = request.headers.authorization;
	if (authorization === undefined || Array.isArray(authorization)) {
		return false;
	}

	const actual = Buffer.from(authorization);
	const expected = Buffer.from(`Bearer ${token}`);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
