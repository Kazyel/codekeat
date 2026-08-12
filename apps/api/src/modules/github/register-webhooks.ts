import type { WebhookStore } from "@codekeat/database";
import type { Probot } from "probot";
import { type RequestReviewDependencies, requestReview } from "../review/request-review.js";
import type { ReviewWorkQueue } from "../review/review-run.js";
import { isAllowedGithubAccount } from "./github-account.js";
import {
  handleInstallationCreated,
  handleInstallationDeleted,
  handleInstallationSuspended,
  handleInstallationUnsuspended,
  handleRepositoriesAdded,
  handleRepositoriesRemoved,
} from "./installation-handler.js";
import { GitHubRepositoryPolicyResolver } from "./load-repository-policy.js";
import { type DeliveryOutcome, processWebhookDelivery } from "./webhook-delivery.js";
import { isDraftPullRequest, type PullRequestContext, toRequestReview } from "./webhook-events.js";

export interface WebhookDependencies {
  readonly store: WebhookStore;
  readonly queue: ReviewWorkQueue;
  readonly allowedAccounts: ReadonlySet<string>;
}

export function registerWebhooks(app: Probot, dependencies: WebhookDependencies): void {
  registerInstallationHandlers(app, dependencies);

  app.on("pull_request.opened", (context) => handlePullRequest(context, dependencies, "opened"));
  app.on("pull_request.reopened", (context) =>
    handlePullRequest(context, dependencies, "reopened"),
  );

  app.on("pull_request.ready_for_review", (context) =>
    handlePullRequest(context, dependencies, "ready_for_review"),
  );

  app.on("pull_request.synchronize", (context) =>
    handlePullRequest(context, dependencies, "synchronize"),
  );
}

function registerInstallationHandlers(app: Probot, dependencies: WebhookDependencies): void {
  const installationDependencies = {
    store: dependencies.store,
    allowedAccounts: dependencies.allowedAccounts,
  };

  app.on("installation.created", (context) =>
    handleInstallationCreated(context, installationDependencies),
  );
  app.on("installation.suspend", (context) =>
    handleInstallationSuspended(context, installationDependencies),
  );
  app.on("installation.unsuspend", (context) =>
    handleInstallationUnsuspended(context, installationDependencies),
  );
  app.on("installation.deleted", (context) =>
    handleInstallationDeleted(context, installationDependencies),
  );
  app.on("installation_repositories.added", (context) =>
    handleRepositoriesAdded(context, installationDependencies),
  );
  app.on("installation_repositories.removed", (context) =>
    handleRepositoriesRemoved(context, installationDependencies),
  );
}

async function handlePullRequest(
  context: PullRequestContext,
  dependencies: WebhookDependencies,
  trigger: "opened" | "reopened" | "ready_for_review" | "synchronize",
): Promise<void> {
  const request = toRequestReview(context, trigger);

  await processWebhookDelivery(
    dependencies.store,
    {
      deliveryId: context.id,
      eventName: `pull_request.${trigger}`,
      installationId: context.payload.installation?.id ?? null,
    },

    async () => {
      if (request === null) {
        return ignored("installation_not_active");
      }

      const ignoreReason = resolvePullRequestIgnoreReason(context, request, dependencies);
      if (ignoreReason !== null) {
        return ignored(ignoreReason);
      }

      dependencies.store.upsertRepository({
        githubRepositoryId: request.repositoryId,
        installationId: request.installationId,
        ownerLogin: request.repositoryOwner,
        name: request.repositoryName,
        defaultBranch: request.repositoryDefaultBranch,
        status: "active",
      });

      const result = await requestReview(
        request,
        createRequestReviewDependencies(context, dependencies),
      );

      logPolicyWarning(context, result.policy?.warningCode ?? null);
      return handled();
    },
  );
}

function resolvePullRequestIgnoreReason(
  context: PullRequestContext,
  request: Exclude<ReturnType<typeof toRequestReview>, null>,
  dependencies: WebhookDependencies,
): string | null {
  if (isDraftPullRequest(context)) {
    return "draft_pull_request";
  }

  if (!isAllowedGithubAccount(request.accountLogin, dependencies.allowedAccounts)) {
    return "github_account_not_allowed";
  }

  const installation = dependencies.store.findInstallation(request.installationId);
  if (installation?.status !== "active") {
    return "installation_not_active";
  }

  const repository = dependencies.store.findRepository(
    request.repositoryId,
    request.installationId,
  );
  if (repository?.status !== "active") {
    return "repository_not_active";
  }

  return null;
}

function createRequestReviewDependencies(
  context: PullRequestContext,
  dependencies: WebhookDependencies,
): RequestReviewDependencies {
  return {
    store: dependencies.store,
    queue: dependencies.queue,
    policyResolver: new GitHubRepositoryPolicyResolver(context),
  };
}

function logPolicyWarning(context: PullRequestContext, warningCode: string | null): void {
  if (warningCode === null) {
    return;
  }
  context.log.warn(
    { deliveryId: context.id, repository: context.payload.repository.full_name, warningCode },
    "repository_policy.invalid_using_default",
  );
}

function handled(): DeliveryOutcome {
  return { kind: "handled" };
}

function ignored(reasonCode: string): DeliveryOutcome {
  return { kind: "ignored", reasonCode };
}
