import { z } from "zod";

import { loadDashboardEnvironment } from "./environment.js";

validateEnvironment();

function validateEnvironment(): void {
  try {
    loadDashboardEnvironment(process.env);
    console.log("Web environment is valid.");
  } catch (error) {
    console.error("Web environment is invalid.");
    printValidationErrors(error);
    process.exitCode = 1;
  }
}

function printValidationErrors(error: unknown): void {
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) {
      console.error(`- ${issue.path.join(".")}: ${issue.message}`);
    }
    return;
  }

  console.error("- Unable to validate the environment.");
}
