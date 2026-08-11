import { and, eq, sql } from "drizzle-orm";

import type { DatabaseConnection } from "./client.js";
import { installations, repositories, reviewRuns, webhookDeliveries } from "./schema/index.js";

export type InstallationStatus = "active" | "suspended" | "deleted";
export type RepositoryStatus = "active" | "removed";
export type DeliveryStatus = "processing" | "handled" | "failed" | "ignored";
export type ReviewRunStatus = "queued" | "running" | "completed" | "failed" | "ignored";
export type PolicySource = "default" | "repository";
export type ReviewTrigger = "opened" | "reopened" | "ready_for_review" | "synchronize";

export interface WebhookDeliveryInput {
  readonly deliveryId: string;
  readonly eventName: string;
  readonly installationId: number | null;
}

export interface InstallationInput {
  readonly githubInstallationId: number;
  readonly accountLogin: string;
  readonly status: InstallationStatus;
}

export interface RepositoryInput {
  readonly githubRepositoryId: number;
  readonly installationId: number;
  readonly ownerLogin: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly status: RepositoryStatus;
}

export interface ReviewRunInput {
  readonly id: string;
  readonly githubRepositoryId: number;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly trigger: ReviewTrigger;
  readonly status: ReviewRunStatus;
  readonly policyJson: string;
  readonly policySource: PolicySource;
  readonly policyWarningCode: string | null;
  readonly ignoreReason: string | null;
}

export interface StoredInstallation {
  readonly status: InstallationStatus;
}

export interface StoredRepository {
  readonly defaultBranch: string;
  readonly status: RepositoryStatus;
}

export type DeliveryClaim = "claimed" | "duplicate";
export type ReviewRunCreation = "created" | "duplicate";

export class WebhookStore {
  constructor(private readonly connection: DatabaseConnection) {}

  claimDelivery(input: WebhookDeliveryInput): DeliveryClaim {
    const current = this.connection.db
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, input.deliveryId))
      .get();

    if (current === undefined) {
      this.insertDelivery(input);
      return "claimed";
    }

    if (current.status !== "failed") {
      return "duplicate";
    }

    this.retryDelivery(input.deliveryId);
    return "claimed";
  }

  markDeliveryHandled(deliveryId: string): void {
    this.setDeliveryStatus(deliveryId, "handled", null, null);
  }

  markDeliveryIgnored(deliveryId: string, reasonCode: string): void {
    this.setDeliveryStatus(deliveryId, "ignored", reasonCode, null);
  }

  markDeliveryFailed(deliveryId: string, failureCode: string): void {
    this.setDeliveryStatus(deliveryId, "failed", null, failureCode);
  }

  upsertInstallation(input: InstallationInput): void {
    const now = currentTimestamp();
    this.connection.db
      .insert(installations)
      .values({ ...input, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: installations.githubInstallationId,
        set: {
          accountLogin: input.accountLogin,
          status: input.status,
          updatedAt: now,
        },
      })
      .run();
  }

  setInstallationStatus(githubInstallationId: number, status: InstallationStatus): void {
    this.connection.db
      .update(installations)
      .set({ status, updatedAt: currentTimestamp() })
      .where(eq(installations.githubInstallationId, githubInstallationId))
      .run();
  }

  findInstallation(githubInstallationId: number): StoredInstallation | null {
    const row = this.connection.db
      .select({ status: installations.status })
      .from(installations)
      .where(eq(installations.githubInstallationId, githubInstallationId))
      .get();

    return row ?? null;
  }

  upsertRepository(input: RepositoryInput): void {
    const now = currentTimestamp();
    this.connection.db
      .insert(repositories)
      .values({ ...input, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: repositories.githubRepositoryId,
        set: {
          installationId: input.installationId,
          ownerLogin: input.ownerLogin,
          name: input.name,
          defaultBranch: input.defaultBranch,
          status: input.status,
          updatedAt: now,
        },
      })
      .run();
  }

  setRepositoryStatus(githubRepositoryId: number, status: RepositoryStatus): void {
    this.connection.db
      .update(repositories)
      .set({ status, updatedAt: currentTimestamp() })
      .where(eq(repositories.githubRepositoryId, githubRepositoryId))
      .run();
  }

  findRepository(githubRepositoryId: number, installationId: number): StoredRepository | null {
    const row = this.connection.db
      .select({ defaultBranch: repositories.defaultBranch, status: repositories.status })
      .from(repositories)
      .where(
        and(
          eq(repositories.githubRepositoryId, githubRepositoryId),
          eq(repositories.installationId, installationId),
        ),
      )
      .get();

    return row ?? null;
  }

  createReviewRun(input: ReviewRunInput): ReviewRunCreation {
    const result = this.connection.db
      .insert(reviewRuns)
      .values({
        ...input,
        errorCode: null,
        createdAt: currentTimestamp(),
        updatedAt: currentTimestamp(),
      })
      .onConflictDoNothing({
        target: [reviewRuns.githubRepositoryId, reviewRuns.pullRequestNumber, reviewRuns.headSha],
      })
      .run();

    return result.changes === 0 ? "duplicate" : "created";
  }

  private insertDelivery(input: WebhookDeliveryInput): void {
    const now = currentTimestamp();
    this.connection.db
      .insert(webhookDeliveries)
      .values({
        ...input,
        status: "processing",
        attempts: 1,
        reasonCode: null,
        failureCode: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  private retryDelivery(deliveryId: string): void {
    this.connection.db
      .update(webhookDeliveries)
      .set({
        status: "processing",
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        failureCode: null,
        updatedAt: currentTimestamp(),
      })
      .where(eq(webhookDeliveries.deliveryId, deliveryId))
      .run();
  }

  private setDeliveryStatus(
    deliveryId: string,
    status: DeliveryStatus,
    reasonCode: string | null,
    failureCode: string | null,
  ): void {
    this.connection.db
      .update(webhookDeliveries)
      .set({ status, reasonCode, failureCode, updatedAt: currentTimestamp() })
      .where(eq(webhookDeliveries.deliveryId, deliveryId))
      .run();
  }
}

function currentTimestamp(): string {
  return new Date().toISOString();
}
