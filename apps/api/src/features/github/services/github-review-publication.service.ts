import { Data, Effect } from "effect";
import { z } from "zod";

import {
	formatReviewReport,
	type PublishableReviewReport,
	type ReviewReportComment,
	type ReviewReportPublisherClient,
} from "#features/review";

const APP_IDENTITY_SCHEMA = z.object({ id: z.number().int().positive(), slug: z.string().min(1) });
const COMMENT_SCHEMA = z.object({
	id: z.number().int().positive(),
	html_url: z.url(),
	issue_url: z.url(),
	body: z
		.string()
		.nullish()
		.transform((body) => body ?? ""),
	user: z.object({ login: z.string().min(1), type: z.string().min(1) }).nullable(),
	performed_via_github_app: z
		.object({ id: z.number().int().positive() })
		.nullish()
		.transform((app) => app ?? null),
});
const COMMENTS_SCHEMA = z.array(COMMENT_SCHEMA);
const HTTP_ERROR_SCHEMA = z.object({ status: z.number().int() });
const PAGE_SIZE = 100;
const PUBLICATION_TIMEOUT_MS = 10_000;

type AppIdentity = z.infer<typeof APP_IDENTITY_SCHEMA>;
type GitHubComment = z.infer<typeof COMMENT_SCHEMA>;

class GitHubPublicationError extends Data.TaggedError("GitHubPublicationError")<{
	readonly code: "request_failed" | "invalid_response" | "publication_timeout";
	readonly status: number | null;
}> {}

type GitHubRequestControl = {
	readonly signal: AbortSignal;
	readonly retries?: number;
};
type GitHubRepositoryRequest = {
	readonly owner: string;
	readonly repo: string;
	readonly request: GitHubRequestControl;
};
interface GitHubPublicationOctokit {
	readonly rest: {
		readonly apps: {
			getAuthenticated(input: { request: GitHubRequestControl }): Promise<{ data: unknown }>;
		};
		readonly issues: {
			createComment(
				input: GitHubRepositoryRequest & {
					readonly issue_number: number;
					readonly body: string;
				},
			): Promise<{ data: unknown }>;
			listComments(
				input: GitHubRepositoryRequest & {
					readonly issue_number: number;
					readonly page: number;
					readonly per_page: number;
				},
			): Promise<{ data: unknown }>;
			getComment(
				input: GitHubRepositoryRequest & {
					readonly comment_id: number;
				},
			): Promise<{ data: unknown }>;
		};
	};
}
interface GitHubReviewPublicationApp {
	auth(githubInstallationId?: number): Promise<GitHubPublicationOctokit>;
}

export class GitHubReviewPublicationService implements ReviewReportPublisherClient {
	constructor(private readonly app: GitHubReviewPublicationApp) {}

	publish(report: PublishableReviewReport): Promise<ReviewReportComment> {
		return Effect.runPromise(
			Effect.acquireUseRelease(
				Effect.sync(() => new AbortController()),
				(controller) =>
					this.publishOnce(report, controller.signal).pipe(
						Effect.timeoutOrElse({
							duration: PUBLICATION_TIMEOUT_MS,
							orElse: () =>
								Effect.fail(
									new GitHubPublicationError({
										code: "publication_timeout",
										status: null,
									}),
								),
						}),
					),
				(controller) => Effect.sync(() => controller.abort()),
			),
		);
	}

	private publishOnce(
		report: PublishableReviewReport,
		signal: AbortSignal,
	): Effect.Effect<ReviewReportComment, GitHubPublicationError> {
		return Effect.gen({ self: this }, function* () {
			const appClient = yield* this.authenticate(undefined);
			const identity = yield* requestGitHub(
				() => appClient.rest.apps.getAuthenticated({ request: { signal } }),
				APP_IDENTITY_SCHEMA,
			);
			const octokit = yield* this.authenticate(report.githubInstallationId);
			const saved = yield* this.findSavedComment(octokit, identity, report, signal);
			if (saved !== null) return toReportComment(saved);
			const marker = `<!-- codekeat:report:${encodeURIComponent(report.reportId)} -->`;
			const previous = yield* this.findMarkedComment(
				octokit,
				identity,
				report,
				marker,
				signal,
			);
			if (previous !== null) return toReportComment(previous);
			const created = yield* requestGitHub(
				() =>
					octokit.rest.issues.createComment({
						owner: report.repositoryOwner,
						repo: report.repositoryName,
						issue_number: report.pullRequestNumber,
						body: `${formatReviewReport(report)}\n\n${marker}`,
						// A POST retry cannot know whether GitHub already accepted the first comment.
						request: { signal, retries: 0 },
					}),
				COMMENT_SCHEMA,
			);
			return toReportComment(created);
		});
	}

	private authenticate(
		installationId: number | undefined,
	): Effect.Effect<GitHubPublicationOctokit, GitHubPublicationError> {
		return Effect.tryPromise({
			try: () => this.app.auth(installationId),
			catch: requestFailure,
		});
	}

	private findSavedComment(
		octokit: GitHubPublicationOctokit,
		identity: AppIdentity,
		report: PublishableReviewReport,
		signal: AbortSignal,
	): Effect.Effect<GitHubComment | null, GitHubPublicationError> {
		return Effect.gen(function* () {
			const commentId = report.githubCommentId;
			if (commentId === null) return null;
			const comment = yield* requestGitHub(
				() =>
					octokit.rest.issues.getComment({
						owner: report.repositoryOwner,
						repo: report.repositoryName,
						comment_id: commentId,
						request: { signal },
					}),
				COMMENT_SCHEMA,
			).pipe(
				Effect.catchIf(
					(error) => error.status === 404,
					() => Effect.succeed(null),
				),
			);
			if (comment === null || !isAppComment(comment, identity)) return null;
			const issuePath = `/repos/${report.repositoryOwner}/${report.repositoryName}/issues/${report.pullRequestNumber}`;
			if (new URL(comment.issue_url).pathname.toLowerCase() !== issuePath.toLowerCase())
				return null;
			return comment;
		});
	}

	private findMarkedComment(
		octokit: GitHubPublicationOctokit,
		identity: AppIdentity,
		report: PublishableReviewReport,
		marker: string,
		signal: AbortSignal,
	): Effect.Effect<GitHubComment | null, GitHubPublicationError> {
		return Effect.gen(function* () {
			for (let page = 1; ; page++) {
				const comments = yield* requestGitHub(
					() =>
						octokit.rest.issues.listComments({
							owner: report.repositoryOwner,
							repo: report.repositoryName,
							issue_number: report.pullRequestNumber,
							page,
							per_page: PAGE_SIZE,
							request: { signal },
						}),
					COMMENTS_SCHEMA,
				);
				const match = comments.find(
					(comment) => isAppComment(comment, identity) && comment.body.includes(marker),
				);
				if (match !== undefined) return match;
				if (comments.length < PAGE_SIZE) return null;
			}
		});
	}
}

function requestGitHub<Value>(
	request: () => Promise<{ data: unknown }>,
	schema: z.ZodType<Value>,
): Effect.Effect<Value, GitHubPublicationError> {
	return Effect.tryPromise({ try: request, catch: requestFailure }).pipe(
		Effect.flatMap((response) => {
			const parsed = schema.safeParse(response.data);
			if (parsed.success) return Effect.succeed(parsed.data);
			return Effect.fail(
				new GitHubPublicationError({ code: "invalid_response", status: null }),
			);
		}),
	);
}

function requestFailure(error: unknown): GitHubPublicationError {
	const parsed = HTTP_ERROR_SCHEMA.safeParse(error);
	return new GitHubPublicationError({
		code: "request_failed",
		status: parsed.success ? parsed.data.status : null,
	});
}

function isAppComment(comment: GitHubComment, identity: AppIdentity): boolean {
	if (comment.user?.type !== "Bot") return false;
	if (comment.performed_via_github_app !== null) {
		return comment.performed_via_github_app.id === identity.id;
	}
	return comment.user.login === `${identity.slug}[bot]`;
}

function toReportComment(comment: GitHubComment): ReviewReportComment {
	return { githubCommentId: comment.id, githubCommentUrl: comment.html_url };
}
