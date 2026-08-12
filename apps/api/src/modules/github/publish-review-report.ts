import type { PublishableReviewReport, ReviewReportComment } from "@codekeat/database";
import type { Probot } from "probot";

import { formatReviewReport } from "../review/review-report.js";

export interface ReviewReportPublisherClient {
  publish(report: PublishableReviewReport): Promise<ReviewReportComment>;
}

export class GitHubReviewReportPublisher implements ReviewReportPublisherClient {
  constructor(private readonly app: Probot) {}

  async publish(report: PublishableReviewReport): Promise<ReviewReportComment> {
    const octokit = await this.app.auth(report.githubInstallationId);
    const body = formatReviewReport(report);
    const comment =
      report.githubCommentId === null
        ? await octokit.rest.issues.createComment({
            owner: report.repositoryOwner,
            repo: report.repositoryName,
            issue_number: report.pullRequestNumber,
            body,
          })
        : await octokit.rest.issues.updateComment({
            owner: report.repositoryOwner,
            repo: report.repositoryName,
            comment_id: report.githubCommentId,
            body,
          });

    return { githubCommentId: comment.data.id, githubCommentUrl: comment.data.html_url };
  }
}
