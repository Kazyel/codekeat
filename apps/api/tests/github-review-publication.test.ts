import { describe, expect, it, vi } from "vitest";
import { ProbotOctokit } from "probot";
import { z } from "zod";

import { GitHubReviewPublicationService } from "#features/github";
import type { PublishableReviewReport } from "#features/review";

interface CreatedComment {
	readonly owner: string;
	readonly repo: string;
	readonly issue_number: number;
	readonly body: string;
}

interface RemoteComment {
	readonly id: number;
	readonly html_url: string;
	readonly issue_url: string;
	readonly body: string;
	readonly user: { readonly login: string; readonly type: string };
	readonly performed_via_github_app: { readonly id: number } | null;
}

const APP_ID = 900;
const APP_SLUG = "codekeat-review";

class RecordedGitHubApp {
	readonly installationIds: number[] = [];
	readonly comments: CreatedComment[] = [];
	readonly remoteComments: RemoteComment[] = [];
	loseNextCreateResponse = false;

	async auth(githubInstallationId?: number) {
		if (githubInstallationId !== undefined) this.installationIds.push(githubInstallationId);
		return {
			rest: {
				apps: {
					getAuthenticated: async () => ({ data: { id: APP_ID, slug: APP_SLUG } }),
				},
				issues: {
					createComment: async (input: CreatedComment) => {
						this.comments.push(input);
						const data = remoteComment(this.comments.length, input.body);
						this.remoteComments.push(data);
						if (this.loseNextCreateResponse) {
							this.loseNextCreateResponse = false;
							throw new Error("Connection reset after GitHub accepted the comment.");
						}
						return { data };
					},
					listComments: (input: { page: number; per_page: number }) =>
						this.readComments(input),
					getComment: async (input: { comment_id: number }) => {
						const data = this.remoteComments.find(
							(comment) => comment.id === input.comment_id,
						);
						if (!data) throw Object.assign(new Error("Not found"), { status: 404 });
						return { data };
					},
				},
			},
		};
	}

	async readComments(input: { page: number; per_page: number }): Promise<{ data: unknown }> {
		return {
			data: this.remoteComments.slice(
				(input.page - 1) * input.per_page,
				input.page * input.per_page,
			),
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

	it.each([0, 100])(
		"recovers a lost acknowledgement after %i preceding comments",
		async (count) => {
			const app = new RecordedGitHubApp();
			for (let index = 0; index < count; index++) {
				app.remoteComments.push(remoteComment(100 + index, "An unrelated discussion."));
			}
			app.loseNextCreateResponse = true;
			const publisher = new GitHubReviewPublicationService(app);
			const report = createReport("report-1", "run-1");
			await expect(publisher.publish(report)).rejects.toMatchObject({
				code: "request_failed",
			});

			const recovered = await publisher.publish(report);

			expect(app.comments).toHaveLength(1);
			expect(recovered.githubCommentId).toBe(1);
		},
	);

	it("does not reuse report markers posted by a user or another app", async () => {
		const app = new RecordedGitHubApp();
		const marker = "<!-- codekeat:report:report-1 -->";
		app.remoteComments.push(
			{ ...remoteComment(100, marker), user: { login: "someone", type: "User" } },
			{
				...remoteComment(101, marker),
				user: { login: "another-app[bot]", type: "Bot" },
				performed_via_github_app: { id: 901 },
			},
		);

		const comment = await new GitHubReviewPublicationService(app).publish({
			...createReport("report-1", "run-1"),
			githubCommentId: 100,
		});

		expect(app.comments).toHaveLength(1);
		expect(comment.githubCommentId).toBe(1);
	});

	it("reuses a saved app comment even when it predates report markers", async () => {
		const app = new RecordedGitHubApp();
		app.remoteComments.push({
			...remoteComment(77, "An older Codekeat review."),
			performed_via_github_app: null,
		});
		const report = { ...createReport("report-1", "run-1"), githubCommentId: 77 };

		const comment = await new GitHubReviewPublicationService(app).publish(report);

		expect(comment.githubCommentId).toBe(77);
		expect(app.comments).toHaveLength(0);
	});

	it.each(["unavailable", "invalid"])(
		"does not create a comment when lookup is %s",
		async (kind) => {
			const app = new RecordedGitHubApp();
			const lookup = vi.spyOn(app, "readComments");
			if (kind === "unavailable") lookup.mockRejectedValue(new Error("GitHub unavailable."));
			else lookup.mockResolvedValue({ data: [{ id: "malformed" }] });
			const publisher = new GitHubReviewPublicationService(app);

			await expect(
				publisher.publish(createReport("report-1", "run-1")),
			).rejects.toMatchObject({
				code: kind === "unavailable" ? "request_failed" : "invalid_response",
			});

			expect(app.comments).toHaveLength(0);
		},
	);

	it("avoids SDK POST retries before recovering an accepted comment", async () => {
		const remoteComments: RemoteComment[] = [];
		const fetchGitHub: typeof fetch = async (input, init) => {
			const request = new Request(input, init);
			if (new URL(request.url).pathname === "/app") {
				return Response.json({ id: APP_ID, slug: APP_SLUG });
			}
			if (request.method === "GET") return Response.json(remoteComments);
			const payload: unknown = await request.json();
			const { body } = z.object({ body: z.string() }).parse(payload);
			remoteComments.push(remoteComment(remoteComments.length + 1, body));
			if (remoteComments.length === 1) throw new Error("Response lost after acceptance.");
			return Response.json(remoteComments.at(-1), { status: 201 });
		};
		const octokit = new ProbotOctokit({
			request: { fetch: fetchGitHub },
			throttle: { enabled: false },
		});
		const publisher = new GitHubReviewPublicationService({ auth: async () => octokit });
		const report = createReport("report-transport", "run-transport");

		await expect(publisher.publish(report)).rejects.toMatchObject({ code: "request_failed" });
		const recovered = await publisher.publish(report);

		expect(remoteComments).toHaveLength(1);
		expect(recovered.githubCommentId).toBe(1);
	});

	it("aborts a stalled GitHub request when the publication deadline expires", async () => {
		vi.useFakeTimers();
		try {
			const started = Promise.withResolvers<AbortSignal>();
			const fetchGitHub: typeof fetch = async (input, init) => {
				const request = new Request(input, init);
				if (new URL(request.url).pathname === "/app") {
					return Response.json({ id: APP_ID, slug: APP_SLUG });
				}
				if (request.method === "GET") return Response.json([]);
				const response = Promise.withResolvers<Response>();
				request.signal.addEventListener("abort", () => {
					response.reject(new DOMException("Request aborted.", "AbortError"));
				});
				started.resolve(request.signal);
				return response.promise;
			};
			const octokit = new ProbotOctokit({
				request: { fetch: fetchGitHub },
				throttle: { enabled: false },
			});
			const publisher = new GitHubReviewPublicationService({ auth: async () => octokit });
			await Promise.all([
				expect(
					publisher.publish(createReport("report-timeout", "run-timeout")),
				).rejects.toMatchObject({ code: "publication_timeout" }),
				vi.advanceTimersByTimeAsync(10_001),
			]);
			const signal = await started.promise;
			expect(signal.aborted).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

function remoteComment(id: number, body: string): RemoteComment {
	return {
		id,
		body,
		html_url: `https://github.com/takeat/codekeat/pull/30#issuecomment-${id}`,
		issue_url: "https://api.github.com/repos/takeat/codekeat/issues/30",
		user: { login: `${APP_SLUG}[bot]`, type: "Bot" },
		performed_via_github_app: { id: APP_ID },
	};
}

function createReport(reportId: string, reviewRunId: string): PublishableReviewReport {
	return {
		reportId,
		githubCommentId: null,
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
