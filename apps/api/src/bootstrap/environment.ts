import { z } from "zod";

const optionalEnvironmentValue = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .pipe(z.string().min(1).optional())
  .optional();

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", {
    message: "URL must use HTTPS.",
  });

const environmentSchema = z
  .object({
    APP_ID: z.string().trim().min(1),
    PRIVATE_KEY: optionalEnvironmentValue,
    PRIVATE_KEY_PATH: optionalEnvironmentValue,
    WEBHOOK_SECRET: z.string().trim().min(1),
    DATABASE_PATH: z.string().trim().min(1),
    ALLOWED_GITHUB_ACCOUNTS: z.string().transform(parseAllowedAccounts),
    GOOGLE_API_KEY: z.string().trim().min(1),
    GEMINI_MODEL: z.string().trim().min(1),
    TAKEAT_MCP_URL: httpsUrl,
    TAKEAT_MCP_TOKEN_URL: httpsUrl,
    TAKEAT_MCP_CLIENT_ID: z.string().trim().min(1),
    TAKEAT_MCP_CLIENT_SECRET: z.string().trim().min(1),
    DASHBOARD_API_TOKEN: z.string().trim().min(1),
    INITIAL_ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
    INITIAL_ADMIN_PASSWORD: z.string().min(8).max(256),
    REVIEW_MODE: z.literal("advisory"),
  })
  .refine((values) => values.PRIVATE_KEY !== undefined || values.PRIVATE_KEY_PATH !== undefined, {
    message: "Configure PRIVATE_KEY or PRIVATE_KEY_PATH.",
    path: ["PRIVATE_KEY"],
  });

export interface ApplicationEnvironment {
  readonly databasePath: string;
  readonly allowedGithubAccounts: ReadonlySet<string>;
  readonly googleApiKey: string;
  readonly geminiModel: string;
  readonly takeatMcpUrl: URL;
  readonly takeatMcpTokenUrl: URL;
  readonly takeatMcpClientId: string;
  readonly takeatMcpClientSecret: string;
  readonly dashboardApiToken: string;
  readonly initialAdminEmail: string;
  readonly initialAdminPassword: string;
}

export function loadEnvironment(values: NodeJS.ProcessEnv): ApplicationEnvironment {
  const parsed = environmentSchema.parse(values);

  return {
    databasePath: parsed.DATABASE_PATH,
    allowedGithubAccounts: new Set(parsed.ALLOWED_GITHUB_ACCOUNTS),
    googleApiKey: parsed.GOOGLE_API_KEY,
    geminiModel: parsed.GEMINI_MODEL,
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
