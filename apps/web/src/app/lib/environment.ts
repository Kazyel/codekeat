import { z } from "zod";

const environmentSchema = z.object({
  CODEKEAT_API_URL: z.string().url(),
  DASHBOARD_API_TOKEN: z.string().trim().min(1),
});

export interface DashboardEnvironment {
  readonly codekeatApiUrl: string;
  readonly dashboardApiToken: string;
}

export function loadDashboardEnvironment(values: NodeJS.ProcessEnv): DashboardEnvironment {
  const parsed = environmentSchema.parse(values);
  return {
    codekeatApiUrl: parsed.CODEKEAT_API_URL,
    dashboardApiToken: parsed.DASHBOARD_API_TOKEN,
  };
}
