import { z } from "zod";

import { loadEnvironment } from "./environment.js";

validateEnvironment();

function validateEnvironment(): void {
  try {
    loadEnvironment(process.env);
    console.log("API environment is valid.");
  } catch (error) {
    console.error("API environment is invalid.");
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
