import {
  createDatabaseConnection,
  type DatabaseConnection,
  migrateDatabase,
  WebhookStore,
} from "@codekeat/database";
import type { ApplicationFunctionOptions, Probot } from "probot";
import { GeminiReviewModel } from "../modules/ai/gemini-review-model.js";
import { TakeatMcpAccessTokenProvider, TakeatMcpTool } from "../modules/ai/takeat-mcp-tool.js";
import { Argon2PasswordHasher } from "../modules/dashboard-auth/argon2-password-hasher.js";
import { DashboardAuthenticator } from "../modules/dashboard-auth/dashboard-authenticator.js";
import { GitHubReviewInputSource } from "../modules/github/load-pull-request-input.js";
import { GitHubReviewReportPublisher } from "../modules/github/publish-review-report.js";
import { createDashboardAuthApiHandler } from "../modules/github/register-dashboard-auth-api.js";
import { createReadApiHandler } from "../modules/github/register-read-api.js";
import { registerWebhooks } from "../modules/github/register-webhooks.js";
import { ReviewRunProcessor } from "../modules/review/process-review-run.js";
import { ReviewReportPublisher } from "../modules/review/publish-review-report.js";
import type { ReviewRunProcessorTask } from "../modules/review/review-run.js";
import { LocalReviewWorkQueue } from "../modules/review/review-run-queue.js";
import type { ApplicationEnvironment } from "./environment.js";

export async function configureApplication(
  app: Probot,
  environment: ApplicationEnvironment,
  options: ApplicationFunctionOptions,
): Promise<DatabaseConnection> {
  const connection = createDatabaseConnection(environment.databasePath);
  try {
    migrateDatabase(connection);

    const store = new WebhookStore(connection);

    const dashboardAuthenticator = new DashboardAuthenticator(store, new Argon2PasswordHasher());
    await dashboardAuthenticator.provisionInitialAdmin({
      email: environment.initialAdminEmail,
      password: environment.initialAdminPassword,
    });

    const takeatMcpAccessTokenProvider = new TakeatMcpAccessTokenProvider(
      environment.takeatMcpTokenUrl,
      environment.takeatMcpClientId,
      environment.takeatMcpClientSecret,
    );

    const model = new GeminiReviewModel(
      environment.googleApiKey,
      environment.geminiModel,
      new TakeatMcpTool(environment.takeatMcpUrl, takeatMcpAccessTokenProvider),
      app.log,
    );

    const publisher = new ReviewReportPublisher(
      store,
      new GitHubReviewReportPublisher(app),
      app.log,
    );

    let processor: ReviewRunProcessor;
    const reviewTask: ReviewRunProcessorTask = {
      async process(reviewRunId: string): Promise<void> {
        await processor.process(reviewRunId);
      },
    };

    const queue = new LocalReviewWorkQueue(reviewTask, publisher, app.log);
    processor = new ReviewRunProcessor(
      store,
      new GitHubReviewInputSource(app),
      model,
      queue,
      app.log,
    );

    registerWebhooks(app, {
      store,
      queue,
      allowedAccounts: environment.allowedGithubAccounts,
    });

    options.addHandler(createReadApiHandler(store, environment.dashboardApiToken));
    options.addHandler(
      createDashboardAuthApiHandler(dashboardAuthenticator, environment.dashboardApiToken),
    );

    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}
