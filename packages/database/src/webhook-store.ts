import { and, count, desc, eq, gt, sql } from "drizzle-orm";

import type { DatabaseConnection } from "./client.js";
import {
  dashboardSessions,
  dashboardUsers,
  findings,
  installations,
  repositories,
  reviewReports,
  reviewRuns,
  webhookDeliveries,
} from "./schema/index.js";

export type InstallationStatus = "active" | "suspended" | "deleted";
export type RepositoryStatus = "active" | "removed";
export type DeliveryStatus = "processing" | "handled" | "failed" | "ignored";
export type ReviewRunStatus = "queued" | "running" | "completed" | "failed" | "ignored";
export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type ReviewReportStatus = "pending" | "publishing" | "published" | "failed";
export type ReviewReportErrorCode = "github_comment_unavailable";
export type ReviewRunIgnoreReason = "repository_policy_disabled" | "superseded_head_sha";
export type ReviewRunErrorCode =
  | "finding_location_invalid"
  | "gemini_invalid_response"
  | "gemini_request_failed"
  | "github_diff_file_limit_exceeded"
  | "github_diff_unavailable";
export type PolicySource = "default" | "repository";
export type ReviewTrigger = "opened" | "reopened" | "ready_for_review" | "synchronize";
export type DashboardUserRole = "admin" | "member";

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

export interface DashboardUserInput {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: DashboardUserRole;
}

export interface DashboardSessionInput {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
}

export interface DashboardUserCredentials {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: DashboardUserRole;
}

export interface AuthenticatedDashboardUser {
  readonly id: string;
  readonly email: string;
  readonly role: DashboardUserRole;
}

export interface FindingInput {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly path: string;
  readonly line: number;
  readonly title: string;
  readonly rationale: string;
}

export interface ReviewReportComment {
  readonly githubCommentId: number;
  readonly githubCommentUrl: string;
}

export interface StoredInstallation {
  readonly status: InstallationStatus;
}

export interface StoredRepository {
  readonly defaultBranch: string;
  readonly status: RepositoryStatus;
}

export interface RunnableReviewRun {
  readonly id: string;
  readonly githubInstallationId: number;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly repositoryFullName: string;
  readonly pullRequestNumber: number;
  readonly headSha: string;
}

export interface ExistingReviewRun {
  readonly id: string;
  readonly status: ReviewRunStatus;
}

export interface PublishableReviewReport {
  readonly reportId: string;
  readonly reviewRunId: string;
  readonly githubInstallationId: number;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly repositoryFullName: string;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly githubCommentId: number | null;
  readonly findings: readonly FindingInput[];
}

export interface ReviewRunSummary {
  readonly id: string;
  readonly repositoryFullName: string;
  readonly pullRequestNumber: number;
  readonly headSha: string;
  readonly trigger: ReviewTrigger;
  readonly status: ReviewRunStatus;
  readonly modelName: string | null;
  readonly findingCount: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly reviewReportStatus: ReviewReportStatus | null;
  readonly githubCommentUrl: string | null;
}

export interface ReviewRunDetail extends ReviewRunSummary {
  readonly policySource: PolicySource;
  readonly policyWarningCode: string | null;
  readonly ignoreReason: string | null;
  readonly errorCode: string | null;
  readonly findings: readonly FindingInput[];
}

export type DeliveryClaim = "claimed" | "duplicate";
export type ReviewRunCreation = "created" | "duplicate";

export class WebhookStore {
  constructor(private readonly connection: DatabaseConnection) {}

  createDashboardUserIfMissing(input: DashboardUserInput): void {
    const now = currentTimestamp();
    this.connection.db
      .insert(dashboardUsers)
      .values({ ...input, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: dashboardUsers.email })
      .run();
  }

  findDashboardUserCredentials(email: string): DashboardUserCredentials | null {
    const user = this.connection.db
      .select({
        id: dashboardUsers.id,
        email: dashboardUsers.email,
        passwordHash: dashboardUsers.passwordHash,
        role: dashboardUsers.role,
      })
      .from(dashboardUsers)
      .where(eq(dashboardUsers.email, email))
      .get();

    return user ?? null;
  }

  createDashboardSession(input: DashboardSessionInput): void {
    this.connection.db
      .insert(dashboardSessions)
      .values({ ...input, createdAt: currentTimestamp() })
      .run();
  }

  findAuthenticatedDashboardUser(
    tokenHash: string,
    now: string,
  ): AuthenticatedDashboardUser | null {
    const user = this.connection.db
      .select({
        id: dashboardUsers.id,
        email: dashboardUsers.email,
        role: dashboardUsers.role,
      })
      .from(dashboardSessions)
      .innerJoin(dashboardUsers, eq(dashboardSessions.userId, dashboardUsers.id))
      .where(and(eq(dashboardSessions.tokenHash, tokenHash), gt(dashboardSessions.expiresAt, now)))
      .get();

    return user ?? null;
  }

  deleteDashboardSession(tokenHash: string): void {
    this.connection.db
      .delete(dashboardSessions)
      .where(eq(dashboardSessions.tokenHash, tokenHash))
      .run();
  }

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
        modelName: null,
        createdAt: currentTimestamp(),
        startedAt: null,
        completedAt: null,
        updatedAt: currentTimestamp(),
      })
      .onConflictDoNothing({
        target: [reviewRuns.githubRepositoryId, reviewRuns.pullRequestNumber, reviewRuns.headSha],
      })
      .run();

    return result.changes === 0 ? "duplicate" : "created";
  }

  claimQueuedReviewRun(reviewRunId: string): RunnableReviewRun | null {
    const now = currentTimestamp();
    const claim = this.connection.db
      .update(reviewRuns)
      .set({ status: "running", startedAt: now, updatedAt: now })
      .where(and(eq(reviewRuns.id, reviewRunId), eq(reviewRuns.status, "queued")))
      .run();

    if (claim.changes === 0) {
      return null;
    }

    const row = this.connection.db
      .select({
        id: reviewRuns.id,
        githubInstallationId: repositories.installationId,
        repositoryOwner: repositories.ownerLogin,
        repositoryName: repositories.name,
        repositoryFullName: sql<string>`${repositories.ownerLogin} || '/' || ${repositories.name}`,
        pullRequestNumber: reviewRuns.pullRequestNumber,
        headSha: reviewRuns.headSha,
      })
      .from(reviewRuns)
      .innerJoin(repositories, eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId))
      .where(eq(reviewRuns.id, reviewRunId))
      .get();

    if (row === undefined) {
      throw new Error("Claimed review run is missing its repository.");
    }

    return row;
  }

  completeReviewRun(
    reviewRunId: string,
    modelName: string,
    reviewFindings: readonly FindingInput[],
    reviewReportId: string,
  ): string {
    const now = currentTimestamp();
    return this.connection.db.transaction((transaction) => {
      if (reviewFindings.length > 0) {
        transaction
          .insert(findings)
          .values(reviewFindings.map((finding) => ({ ...finding, reviewRunId, createdAt: now })))
          .run();
      }

      transaction
        .update(reviewRuns)
        .set({
          status: "completed",
          modelName,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(reviewRuns.id, reviewRunId))
        .run();

      const run = transaction
        .select({
          githubRepositoryId: reviewRuns.githubRepositoryId,
          pullRequestNumber: reviewRuns.pullRequestNumber,
        })
        .from(reviewRuns)
        .where(eq(reviewRuns.id, reviewRunId))
        .get();

      if (run === undefined) {
        throw new Error("Completed review run is missing.");
      }

      transaction
        .insert(reviewReports)
        .values({
          id: reviewReportId,
          githubRepositoryId: run.githubRepositoryId,
          pullRequestNumber: run.pullRequestNumber,
          reviewRunId,
          githubCommentId: null,
          githubCommentUrl: null,
          status: "pending",
          errorCode: null,
          createdAt: now,
          updatedAt: now,
          publishedAt: null,
        })
        .onConflictDoUpdate({
          target: [reviewReports.githubRepositoryId, reviewReports.pullRequestNumber],
          set: {
            reviewRunId,
            status: "pending",
            errorCode: null,
            updatedAt: now,
            publishedAt: null,
          },
        })
        .run();

      const report = transaction
        .select({ id: reviewReports.id })
        .from(reviewReports)
        .where(
          and(
            eq(reviewReports.githubRepositoryId, run.githubRepositoryId),
            eq(reviewReports.pullRequestNumber, run.pullRequestNumber),
          ),
        )
        .get();

      if (report === undefined) {
        throw new Error("Completed review run is missing its report.");
      }

      return report.id;
    });
  }

  findReviewRun(
    githubRepositoryId: number,
    pullRequestNumber: number,
    headSha: string,
  ): ExistingReviewRun | null {
    const run = this.connection.db
      .select({ id: reviewRuns.id, status: reviewRuns.status })
      .from(reviewRuns)
      .where(
        and(
          eq(reviewRuns.githubRepositoryId, githubRepositoryId),
          eq(reviewRuns.pullRequestNumber, pullRequestNumber),
          eq(reviewRuns.headSha, headSha),
        ),
      )
      .get();

    return run ?? null;
  }

  requeueReviewRun(reviewRunId: string, trigger: ReviewTrigger): boolean {
    const result = this.connection.db
      .update(reviewRuns)
      .set({
        trigger,
        status: "queued",
        errorCode: null,
        ignoreReason: null,
        modelName: null,
        startedAt: null,
        completedAt: null,
        updatedAt: currentTimestamp(),
      })
      .where(
        and(eq(reviewRuns.id, reviewRunId), sql`${reviewRuns.status} IN ('failed', 'ignored')`),
      )
      .run();

    return result.changes > 0;
  }

  prepareReviewReport(reviewRunId: string, reviewReportId: string): string | null {
    const now = currentTimestamp();
    const run = this.connection.db
      .select({
        githubRepositoryId: reviewRuns.githubRepositoryId,
        pullRequestNumber: reviewRuns.pullRequestNumber,
      })
      .from(reviewRuns)
      .where(and(eq(reviewRuns.id, reviewRunId), eq(reviewRuns.status, "completed")))
      .get();

    if (run === undefined) {
      return null;
    }

    const currentReport = this.connection.db
      .select({
        id: reviewReports.id,
        reviewRunId: reviewReports.reviewRunId,
        status: reviewReports.status,
      })
      .from(reviewReports)
      .where(
        and(
          eq(reviewReports.githubRepositoryId, run.githubRepositoryId),
          eq(reviewReports.pullRequestNumber, run.pullRequestNumber),
        ),
      )
      .get();

    if (currentReport?.reviewRunId === reviewRunId && currentReport.status === "published") {
      return null;
    }

    this.connection.db
      .insert(reviewReports)
      .values({
        id: reviewReportId,
        githubRepositoryId: run.githubRepositoryId,
        pullRequestNumber: run.pullRequestNumber,
        reviewRunId,
        githubCommentId: null,
        githubCommentUrl: null,
        status: "pending",
        errorCode: null,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      })
      .onConflictDoUpdate({
        target: [reviewReports.githubRepositoryId, reviewReports.pullRequestNumber],
        set: {
          reviewRunId,
          status: "pending",
          errorCode: null,
          updatedAt: now,
          publishedAt: null,
        },
      })
      .run();

    const report = this.connection.db
      .select({ id: reviewReports.id })
      .from(reviewReports)
      .where(
        and(
          eq(reviewReports.githubRepositoryId, run.githubRepositoryId),
          eq(reviewReports.pullRequestNumber, run.pullRequestNumber),
        ),
      )
      .get();

    return report?.id ?? null;
  }

  claimReviewReport(reviewReportId: string): PublishableReviewReport | null {
    const claim = this.connection.db
      .update(reviewReports)
      .set({ status: "publishing", updatedAt: currentTimestamp() })
      .where(
        and(
          eq(reviewReports.id, reviewReportId),
          sql`${reviewReports.status} IN ('pending', 'failed')`,
        ),
      )
      .run();

    if (claim.changes === 0) {
      return null;
    }

    const report = this.connection.db
      .select({
        reportId: reviewReports.id,
        reviewRunId: reviewReports.reviewRunId,
        githubInstallationId: repositories.installationId,
        repositoryOwner: repositories.ownerLogin,
        repositoryName: repositories.name,
        repositoryFullName: sql<string>`${repositories.ownerLogin} || '/' || ${repositories.name}`,
        pullRequestNumber: reviewReports.pullRequestNumber,
        headSha: reviewRuns.headSha,
        githubCommentId: reviewReports.githubCommentId,
      })
      .from(reviewReports)
      .innerJoin(reviewRuns, eq(reviewReports.reviewRunId, reviewRuns.id))
      .innerJoin(
        repositories,
        eq(reviewReports.githubRepositoryId, repositories.githubRepositoryId),
      )
      .where(eq(reviewReports.id, reviewReportId))
      .get();

    if (report === undefined) {
      throw new Error("Claimed review report is missing its review run.");
    }

    const reportFindings = this.connection.db
      .select({
        id: findings.id,
        severity: findings.severity,
        path: findings.path,
        line: findings.line,
        title: findings.title,
        rationale: findings.rationale,
      })
      .from(findings)
      .where(eq(findings.reviewRunId, report.reviewRunId))
      .all();

    return { ...report, findings: reportFindings };
  }

  completeReviewReport(reviewReportId: string, comment: ReviewReportComment): void {
    const now = currentTimestamp();
    this.connection.db
      .update(reviewReports)
      .set({
        status: "published",
        githubCommentId: comment.githubCommentId,
        githubCommentUrl: comment.githubCommentUrl,
        errorCode: null,
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(reviewReports.id, reviewReportId))
      .run();
  }

  failReviewReport(reviewReportId: string, errorCode: ReviewReportErrorCode): void {
    this.connection.db
      .update(reviewReports)
      .set({ status: "failed", errorCode, updatedAt: currentTimestamp() })
      .where(eq(reviewReports.id, reviewReportId))
      .run();
  }

  listReviewRunSummaries(): readonly ReviewRunSummary[] {
    const rows = this.connection.db
      .select({
        id: reviewRuns.id,
        repositoryFullName: sql<string>`${repositories.ownerLogin} || '/' || ${repositories.name}`,
        pullRequestNumber: reviewRuns.pullRequestNumber,
        headSha: reviewRuns.headSha,
        trigger: reviewRuns.trigger,
        status: reviewRuns.status,
        modelName: reviewRuns.modelName,
        findingCount: count(findings.id),
        createdAt: reviewRuns.createdAt,
        completedAt: reviewRuns.completedAt,
        reviewReportStatus: reviewReports.status,
        githubCommentUrl: reviewReports.githubCommentUrl,
      })
      .from(reviewRuns)
      .innerJoin(repositories, eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId))
      .leftJoin(findings, eq(findings.reviewRunId, reviewRuns.id))
      .leftJoin(reviewReports, eq(reviewReports.reviewRunId, reviewRuns.id))
      .groupBy(reviewRuns.id)
      .orderBy(desc(reviewRuns.createdAt))
      .limit(50)
      .all();

    return rows.map((row) => ({ ...row, findingCount: Number(row.findingCount) }));
  }

  findReviewRunDetail(reviewRunId: string): ReviewRunDetail | null {
    const run = this.connection.db
      .select({
        id: reviewRuns.id,
        repositoryFullName: sql<string>`${repositories.ownerLogin} || '/' || ${repositories.name}`,
        pullRequestNumber: reviewRuns.pullRequestNumber,
        headSha: reviewRuns.headSha,
        trigger: reviewRuns.trigger,
        status: reviewRuns.status,
        modelName: reviewRuns.modelName,
        createdAt: reviewRuns.createdAt,
        completedAt: reviewRuns.completedAt,
        policySource: reviewRuns.policySource,
        policyWarningCode: reviewRuns.policyWarningCode,
        ignoreReason: reviewRuns.ignoreReason,
        errorCode: reviewRuns.errorCode,
        reviewReportStatus: reviewReports.status,
        githubCommentUrl: reviewReports.githubCommentUrl,
      })
      .from(reviewRuns)
      .innerJoin(repositories, eq(reviewRuns.githubRepositoryId, repositories.githubRepositoryId))
      .leftJoin(reviewReports, eq(reviewReports.reviewRunId, reviewRuns.id))
      .where(eq(reviewRuns.id, reviewRunId))
      .get();

    if (run === undefined) {
      return null;
    }

    const runFindings = this.connection.db
      .select({
        id: findings.id,
        severity: findings.severity,
        path: findings.path,
        line: findings.line,
        title: findings.title,
        rationale: findings.rationale,
      })
      .from(findings)
      .where(eq(findings.reviewRunId, reviewRunId))
      .orderBy(findings.severity, findings.path, findings.line)
      .all();

    return {
      ...run,
      findingCount: runFindings.length,
      findings: runFindings,
    };
  }

  failReviewRun(reviewRunId: string, errorCode: ReviewRunErrorCode): void {
    const now = currentTimestamp();
    this.connection.db
      .update(reviewRuns)
      .set({ status: "failed", errorCode, completedAt: now, updatedAt: now })
      .where(eq(reviewRuns.id, reviewRunId))
      .run();
  }

  ignoreReviewRun(reviewRunId: string, ignoreReason: ReviewRunIgnoreReason): void {
    const now = currentTimestamp();
    this.connection.db
      .update(reviewRuns)
      .set({ status: "ignored", ignoreReason, completedAt: now, updatedAt: now })
      .where(eq(reviewRuns.id, reviewRunId))
      .run();
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
