import { z } from "zod";

const optionalEnvironmentValue = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .pipe(z.string().min(1).optional())
  .optional();

const environmentSchema = z
  .object({
    APP_ID: z.string().trim().min(1),
    PRIVATE_KEY: optionalEnvironmentValue,
    PRIVATE_KEY_PATH: optionalEnvironmentValue,
    WEBHOOK_SECRET: z.string().trim().min(1),
    DATABASE_PATH: z.string().trim().min(1),
    ALLOWED_GITHUB_ACCOUNTS: z.string().transform(parseAllowedAccounts),
    REVIEW_MODE: z.literal("advisory"),
  })
  .refine((values) => values.PRIVATE_KEY !== undefined || values.PRIVATE_KEY_PATH !== undefined, {
    message: "Configure PRIVATE_KEY or PRIVATE_KEY_PATH.",
    path: ["PRIVATE_KEY"],
  });

export interface ApplicationEnvironment {
  readonly databasePath: string;
  readonly allowedGithubAccounts: ReadonlySet<string>;
}

export function loadEnvironment(values: NodeJS.ProcessEnv): ApplicationEnvironment {
  const parsed = environmentSchema.parse(values);

  return {
    databasePath: parsed.DATABASE_PATH,
    allowedGithubAccounts: new Set(parsed.ALLOWED_GITHUB_ACCOUNTS),
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
