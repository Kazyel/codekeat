import { z } from "zod";
import {
	DASHBOARD_PASSWORD_MAXIMUM_LENGTH,
	DASHBOARD_PASSWORD_MINIMUM_LENGTH,
} from "#features/auth";

const OPTIONAL_ENVIRONMENT_VALUE = z
	.string()
	.trim()
	.transform((value) => (value === "" ? undefined : value))
	.pipe(z.string().min(1).optional())
	.optional();

const HTTPS_URL = z
	.string()
	.trim()
	.url()
	.refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", {
		message: "URL must use HTTPS.",
	});

const ENVIRONMENT_SCHEMA = z
	.object({
		APP_ID: z.string().trim().min(1),
		PRIVATE_KEY: OPTIONAL_ENVIRONMENT_VALUE,
		PRIVATE_KEY_PATH: OPTIONAL_ENVIRONMENT_VALUE,
		WEBHOOK_SECRET: z.string().trim().min(1),
		DATABASE_PATH: z.string().trim().min(1),
		ALLOWED_GITHUB_ACCOUNTS: z.string().transform(parseAllowedAccounts),
		GOOGLE_API_KEY: z.string().trim().min(1),
		TAKEAT_MCP_URL: HTTPS_URL,
		TAKEAT_MCP_TOKEN_URL: HTTPS_URL,
		TAKEAT_MCP_CLIENT_ID: z.string().trim().min(1),
		TAKEAT_MCP_CLIENT_SECRET: z.string().trim().min(1),
		DASHBOARD_API_TOKEN: z.string().trim().min(1),
		INITIAL_ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
		INITIAL_ADMIN_PASSWORD: z
			.string()
			.min(DASHBOARD_PASSWORD_MINIMUM_LENGTH)
			.max(DASHBOARD_PASSWORD_MAXIMUM_LENGTH),
		REVIEW_MODE: z.literal("advisory"),
		REVIEW_CONCURRENCY: z.coerce.number().int().positive().default(5),
		REVIEW_UNIT_CONCURRENCY: z.coerce.number().int().positive().default(2),
		REVIEW_MODEL_CONCURRENCY: z.coerce.number().int().positive().default(5),
		GOOGLE_REQUESTS_PER_MINUTE: OPTIONAL_ENVIRONMENT_VALUE.pipe(
			z.coerce.number<string | undefined>().int().positive().optional(),
		),
		GOOGLE_INPUT_TOKENS_PER_MINUTE: OPTIONAL_ENVIRONMENT_VALUE.pipe(
			z.coerce.number<string | undefined>().int().positive().optional(),
		),
	})
	.refine((values) => values.PRIVATE_KEY !== undefined || values.PRIVATE_KEY_PATH !== undefined, {
		message: "Configure PRIVATE_KEY or PRIVATE_KEY_PATH.",
		path: ["PRIVATE_KEY"],
	});

export interface ApplicationEnvironment {
	readonly reviewConcurrency: number;
	readonly reviewUnitConcurrency: number;
	readonly reviewModelConcurrency: number;
	readonly googleRequestsPerMinute: number | null;
	readonly googleInputTokensPerMinute: number | null;
	readonly databasePath: string;
	readonly allowedGithubAccounts: ReadonlySet<string>;
	readonly googleApiKey: string;
	readonly takeatMcpUrl: URL;
	readonly takeatMcpTokenUrl: URL;
	readonly takeatMcpClientId: string;
	readonly takeatMcpClientSecret: string;
	readonly dashboardApiToken: string;
	readonly initialAdminEmail: string;
	readonly initialAdminPassword: string;
}

export function loadEnvironment(values: NodeJS.ProcessEnv): ApplicationEnvironment {
	const parsed = ENVIRONMENT_SCHEMA.parse(values);

	return {
		reviewConcurrency: parsed.REVIEW_CONCURRENCY,
		reviewUnitConcurrency: parsed.REVIEW_UNIT_CONCURRENCY,
		reviewModelConcurrency: parsed.REVIEW_MODEL_CONCURRENCY,
		googleRequestsPerMinute: parsed.GOOGLE_REQUESTS_PER_MINUTE ?? null,
		googleInputTokensPerMinute: parsed.GOOGLE_INPUT_TOKENS_PER_MINUTE ?? null,
		databasePath: parsed.DATABASE_PATH,
		allowedGithubAccounts: new Set(parsed.ALLOWED_GITHUB_ACCOUNTS),
		googleApiKey: parsed.GOOGLE_API_KEY,
		takeatMcpUrl: new URL(parsed.TAKEAT_MCP_URL),
		takeatMcpTokenUrl: new URL(parsed.TAKEAT_MCP_TOKEN_URL),
		takeatMcpClientId: parsed.TAKEAT_MCP_CLIENT_ID,
		takeatMcpClientSecret: parsed.TAKEAT_MCP_CLIENT_SECRET,
		dashboardApiToken: parsed.DASHBOARD_API_TOKEN,
		initialAdminEmail: parsed.INITIAL_ADMIN_EMAIL,
		initialAdminPassword: parsed.INITIAL_ADMIN_PASSWORD,
	};
}

function parseAllowedAccounts(value: string): readonly string[] {
	const accounts = value
		.split(",")
		.map((account) => account.trim().toLowerCase())
		.filter((account) => account.length > 0);

	if (accounts.length === 0) {
		throw new Error("ALLOWED_GITHUB_ACCOUNTS must contain at least one account.");
	}

	return [...new Set(accounts)];
}
