import {
	formatReviewReport,
	type PublishableReviewReport,
	type ReviewReportComment,
	type ReviewReportPublisherClient,
} from "#features/review";

interface GitHubReviewPublicationApp {
	auth(githubInstallationId: number): Promise<{
		readonly rest: {
			readonly issues: {
				createComment(input: {
					readonly owner: string;
					readonly repo: string;
					readonly issue_number: number;
					readonly body: string;
				}): Promise<{
					readonly data: { readonly id: number; readonly html_url: string };
				}>;
			};
		};
	}>;
}

export class GitHubReviewPublicationService implements ReviewReportPublisherClient {
	constructor(private readonly app: GitHubReviewPublicationApp) {}

	async publish(report: PublishableReviewReport): Promise<ReviewReportComment> {
		const octokit = await this.app.auth(report.githubInstallationId);

		const body = formatReviewReport(report);
		const comment = await octokit.rest.issues.createComment({
			owner: report.repositoryOwner,
			repo: report.repositoryName,
			issue_number: report.pullRequestNumber,
			body,
		});

		return { githubCommentId: comment.data.id, githubCommentUrl: comment.data.html_url };
	}
}
