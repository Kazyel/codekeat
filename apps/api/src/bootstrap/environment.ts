import { z } from "zod";

const environmentSchema = z.object({
  APP_ID: z.string().trim().min(1),
  PRIVATE_KEY: z.string().trim().min(1),
  WEBHOOK_SECRET: z.string().trim().min(1),
  DATABASE_PATH: z.string().trim().min(1),
  ALLOWED_GITHUB_ORGANIZATIONS: z.string().transform(parseAllowedOrganizations),
  REVIEW_MODE: z.literal("advisory"),
});

export interface ApplicationEnvironment {
  readonly databasePath: string;
  readonly allowedGithubOrganizations: ReadonlySet<string>;
}

export function loadEnvironment(values: NodeJS.ProcessEnv): ApplicationEnvironment {
  const parsed = environmentSchema.parse(values);

  return {
    databasePath: parsed.DATABASE_PATH,
    allowedGithubOrganizations: new Set(parsed.ALLOWED_GITHUB_ORGANIZATIONS),
  };
}

function parseAllowedOrganizations(value: string): readonly string[] {
  const organizations = value
    .split(",")
    .map((organization) => organization.trim().toLowerCase())
    .filter((organization) => organization.length > 0);

  if (organizations.length === 0) {
    throw new Error("ALLOWED_GITHUB_ORGANIZATIONS must contain at least one organization.");
  }

  return [...new Set(organizations)];
}
