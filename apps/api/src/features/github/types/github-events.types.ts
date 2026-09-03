import type { Context } from "probot";

export type PullRequestEventName =
	| "pull_request.opened"
	| "pull_request.reopened"
	| "pull_request.ready_for_review"
	| "pull_request.synchronize";

export type PullRequestContext = Context<PullRequestEventName>;
