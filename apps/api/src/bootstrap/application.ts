import {
  createDatabaseConnection,
  type DatabaseConnection,
  migrateDatabase,
  WebhookStore,
} from "@codekeat/database";
import type { Probot } from "probot";
import { registerWebhooks } from "../modules/github/register-webhooks.js";
import { LocalReviewRunQueue } from "../modules/review/review-run-queue.js";
import type { ApplicationEnvironment } from "./environment.js";

export function configureApplication(
  app: Probot,
  environment: ApplicationEnvironment,
): DatabaseConnection {
  const connection = createDatabaseConnection(environment.databasePath);
  migrateDatabase(connection);

  registerWebhooks(app, {
    store: new WebhookStore(connection),
    queue: new LocalReviewRunQueue(app.log),
    allowedAccounts: environment.allowedGithubAccounts,
  });

  return connection;
}
