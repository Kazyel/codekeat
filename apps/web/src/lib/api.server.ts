import type { z } from "zod";

import { loadEnvironment } from "@/bootstrap/environment";

export type ApiErrorCode =
	| "bad_request"
	| "unauthorized"
	| "forbidden"
	| "not_found"
	| "conflict"
	| "unavailable"
	| "invalid_response";

export class ApiError extends Error {
	constructor(
		readonly code: ApiErrorCode,
		readonly status: number,
	) {
		super(code);
		this.name = "ApiError";
	}
}

interface ApiRequestOptions {
	readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
	readonly body?: unknown;
	readonly sessionToken?: string;
}

export async function requestApi<T>(
	path: string,
	schema: z.ZodType<T>,
	options: ApiRequestOptions = {},
): Promise<T> {
	const environment = loadEnvironment(process.env);
	const url = new URL(path, environment.apiUrl);
	const headers = new Headers({
		Authorization: `Bearer ${environment.dashboardApiToken}`,
	});

	if (options.sessionToken) headers.set("x-dashboard-session", options.sessionToken);
	if (options.body !== undefined) headers.set("content-type", "application/json");

	let response: Response;
	try {
		response = await fetch(url, {
			method: options.method ?? "GET",
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	} catch {
		throw new ApiError("unavailable", 503);
	}

	if (!response.ok) throw new ApiError(errorCodeForStatus(response.status), response.status);
	if (response.status === 204) return schema.parse(undefined);

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new ApiError("invalid_response", 502);
	}

	const parsed = schema.safeParse(payload);
	if (!parsed.success) throw new ApiError("invalid_response", 502);
	return parsed.data;
}

function errorCodeForStatus(status: number): ApiErrorCode {
	switch (status) {
		case 400:
			return "bad_request";
		case 401:
			return "unauthorized";
		case 403:
			return "forbidden";
		case 404:
			return "not_found";
		case 409:
			return "conflict";
		default:
			return "unavailable";
	}
}
