import { describe, expect, it } from "vitest";

import { GitHubReviewPublicationService } from "#features/github";
import type { PublishableReviewReport } from "#features/review";

interface CreatedComment {
	readonly owner: string;
	readonly repo: string;
	readonly issue_number: number;
	readonly body: string;
}

class RecordedGitHubApp {
	readonly installationIds: number[] = [];
	readonly comments: CreatedComment[] = [];

	async auth(githubInstallationId: number) {
		this.installationIds.push(githubInstallationId);
		return {
			rest: {
				issues: {
					createComment: async (input: CreatedComment) => {
						this.comments.push(input);
						return {
							data: {
								id: this.comments.length,
								html_url: `https://github.com/takeat/codekeat/pull/30#issuecomment-${this.comments.length}`,
							},
						};
					},
				},
			},
		};
	}
}

describe("GitHubReviewPublicationService", () => {
	it("creates a new issue comment for each review report", async () => {
		const app = new RecordedGitHubApp();
		const publisher = new GitHubReviewPublicationService(app);

		const first = await publisher.publish(createReport("report-1", "run-1"));
		const second = await publisher.publish(createReport("report-2", "run-2"));

		expect(app.installationIds).toEqual([10, 10]);
		expect(app.comments).toHaveLength(2);
		expect(app.comments.map((comment) => comment.issue_number)).toEqual([30, 30]);
		expect(first.githubCommentId).toBe(1);
		expect(second.githubCommentId).toBe(2);
	});
});

function createReport(reportId: string, reviewRunId: string): PublishableReviewReport {
	return {
		reportId,
		reviewRunId,
		githubInstallationId: 10,
		repositoryOwner: "takeat",
		repositoryName: "codekeat",
		repositoryFullName: "takeat/codekeat",
		pullRequestNumber: 30,
		headSha: "a".repeat(40),
		findings: [],
	};
}
