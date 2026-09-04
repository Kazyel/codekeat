import { z } from "zod";

const ENVIRONMENT_SCHEMA = z.object({
	CODEKEAT_API_URL: z.string().trim().pipe(z.url()),
	DASHBOARD_API_TOKEN: z.string().trim().min(1),
});

export interface WebEnvironment {
	readonly apiUrl: URL;
	readonly dashboardApiToken: string;
}

export function loadEnvironment(values: NodeJS.ProcessEnv): WebEnvironment {
	const parsed = ENVIRONMENT_SCHEMA.parse(values);

	return {
		apiUrl: new URL(parsed.CODEKEAT_API_URL),
		dashboardApiToken: parsed.DASHBOARD_API_TOKEN,
	};
}
