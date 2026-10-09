import { Effect } from "effect";
import parseDiff, { type File } from "parse-diff";
import { z } from "zod";

import {
	decodeGitDiffPath,
	isRepositoryPath,
	type ReviewInputChunk,
	type ReviewInputLoadResult,
	type ReviewInputSource,
	type RunnableReviewRun,
	type ReviewRunIgnoreReason,
	type ReviewMetricRecorder,
} from "#features/review";
import {
	githubContextRequests,
	observeGitHubContextRequest,
} from "../utils/github-context-request.util.js";
import { MAXIMUM_PULL_REQUEST_FILES } from "../constants/github.constants.js";
import type { GitHubAccessRepository } from "../repositories/github-access.repository.js";
import { loadCatalogReviewContext } from "./github-catalog-review-context.service.js";
import {
	createGitHubSourceCatalog,
	type GitHubSourceComparisonApi,
	type GitHubSourceGitApi,
} from "./github-source-catalog.service.js";

const PULL_REQUEST_SCHEMA = z.object({
	base: z.object({
		repo: z.object({ id: z.number().int().positive() }),
		sha: z.string().regex(/^[a-f0-9]{40}$/),
	}),
	body: z.string().nullable(),
	changed_files: z.number().int().nonnegative(),
	draft: z.boolean(),
	head: z.object({
		sha: z.string().regex(/^[a-f0-9]{40}$/),
		repo: z.object({ full_name: z.string().regex(/^[^/]+\/[^/]+$/) }).nullable(),
	}),
	state: z.enum(["open", "closed"]),
	title: z.string(),
});

type GitHubPullRequest = z.infer<typeof PULL_REQUEST_SCHEMA>;

type PullRequestLocation = {
	readonly owner: string;
	readonly repo: string;
	readonly pull_number: number;
	readonly request?: { readonly signal?: AbortSignal };
};

interface GitHubReviewInputApp {
	auth(githubInstallationId: number): Promise<{
		readonly rest: {
			readonly repos: GitHubSourceComparisonApi;
			readonly git: GitHubSourceGitApi;
			readonly pulls: {
				get(location: PullRequestLocation): Promise<{ readonly data: unknown }>;
			};
		};
		request(
			route: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
			location: PullRequestLocation & { readonly headers: { readonly accept: string } },
		): Promise<{ readonly data: unknown }>;
	}>;
}
interface GitHubReviewInputOptions {
	readonly artifactDirectory: string;
	readonly getInputTokenLimit: (modelApiName: string, signal: AbortSignal) => Promise<number>;
}

export class GitHubReviewInputService implements ReviewInputSource {
	constructor(
		private readonly app: GitHubReviewInputApp,
		private readonly accessRepository: GitHubAccessRepository,
		private readonly options: GitHubReviewInputOptions,
	) {}

	async load(
		run: RunnableReviewRun,
		signal?: AbortSignal,
		recordMetric?: ReviewMetricRecorder,
	): Promise<ReviewInputLoadResult> {
		return this.loadAuthorizedInput(
			run,
			signal ?? new AbortController().signal,
			recordMetric ?? (() => undefined),
		);
	}
	private async loadAuthorizedInput(
		run: RunnableReviewRun,
		signal: AbortSignal,
		recordMetric: ReviewMetricRecorder,
	): Promise<ReviewInputLoadResult> {
		try {
			const octokit = await this.app.auth(run.githubInstallationId);

			const location = {
				owner: run.repositoryOwner,
				repo: run.repositoryName,
				pull_number: run.pullRequestNumber,
				request: { signal },
			};
			const response = await inputRequest(
				(requestSignal) =>
					octokit.rest.pulls.get({ ...location, request: { signal: requestSignal } }),
				signal,
				recordMetric,
			);
			const pullRequest = PULL_REQUEST_SCHEMA.parse(response.data);
			const disposition = this.inputDisposition(pullRequest, run);
			if (disposition !== null) return disposition;

			const diffResponse = await inputRequest(
				(requestSignal) =>
					octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
						...location,
						request: { signal: requestSignal },
						headers: { accept: "application/vnd.github.diff" },
					}),
				signal,
				recordMetric,
			);

			const diff = z.string().parse(diffResponse.data);
			const currentResponse = await inputRequest(
				(requestSignal) =>
					octokit.rest.pulls.get({ ...location, request: { signal: requestSignal } }),
				signal,
				recordMetric,
			);
			const currentPullRequest = PULL_REQUEST_SCHEMA.parse(currentResponse.data);
			const currentIgnoreReason = this.getSnapshotIgnoreReason(
				pullRequest,
				currentPullRequest,
				run,
			);
			if (currentIgnoreReason !== null) {
				return { kind: "ignored", ignoreReason: currentIgnoreReason };
			}
			const chunks = createCompleteReviewChunks(diff, pullRequest.changed_files);
			const inputTokenLimit = await availableInputTokenLimit(
				this.options.getInputTokenLimit,
				run.model.apiName,
				signal,
			);
			if (inputTokenLimit === null)
				return { kind: "failed", errorCode: "gemini_capacity_unavailable" };
			const sources = await createGitHubSourceCatalog(
				octokit.rest.git,
				octokit.rest.repos,
				{
					reviewRunId: run.id,
					baseRepositoryFullName: run.repositoryFullName,
					headRepositoryFullName: headRepositoryFullName(pullRequest.head.repo),
					baseSha: pullRequest.base.sha,
					headSha: run.headSha,
					body: pullRequest.body,
					diff,
				},
				this.options.artifactDirectory,
				signal,
				recordMetric,
			);
			const repositoryContext = await loadCatalogReviewContext(
				sources,
				chunks,
				pullRequest.body,
				inputTokenLimit,
				signal,
			);

			return {
				kind: "ready",
				sources,
				input: {
					baseSha: pullRequest.base.sha,
					body: pullRequest.body,
					chunks,
					headSha: run.headSha,
					githubInstallationAccountLogin: run.githubInstallationAccountLogin,
					pullRequestNumber: run.pullRequestNumber,
					repositoryFullName: run.repositoryFullName,
					reviewRunId: run.id,
					repositoryContext,
					title: pullRequest.title,
				},
			};
		} catch {
			return { kind: "failed", errorCode: "github_diff_unavailable" };
		}
	}
	private inputDisposition(
		pullRequest: GitHubPullRequest,
		run: RunnableReviewRun,
	): ReviewInputLoadResult | null {
		const ignoreReason = this.getInputIgnoreReason(pullRequest, run);
		if (ignoreReason !== null) return { kind: "ignored", ignoreReason };
		if (pullRequest.changed_files > MAXIMUM_PULL_REQUEST_FILES)
			return { kind: "failed", errorCode: "github_diff_file_limit_exceeded" };
		return null;
	}

	private getSnapshotIgnoreReason(
		previous: GitHubPullRequest,
		current: GitHubPullRequest,
		run: RunnableReviewRun,
	): ReviewRunIgnoreReason | null {
		const ignoreReason = this.getInputIgnoreReason(current, run);
		if (ignoreReason !== null) {
			return ignoreReason;
		}
		return previous.base.sha === current.base.sha ? null : "superseded_base_sha";
	}

	private getInputIgnoreReason(
		pullRequest: GitHubPullRequest,
		run: RunnableReviewRun,
	): ReviewRunIgnoreReason | null {
		const installation = this.accessRepository.findInstallation(run.githubInstallationId);
		if (installation?.status !== "active") {
			return "installation_not_active";
		}
		const repository = this.accessRepository.findRepository(
			pullRequest.base.repo.id,
			run.githubInstallationId,
		);
		if (repository?.status !== "active") {
			return "repository_not_active";
		}
		return getPullRequestIgnoreReason(pullRequest, run.headSha);
	}
}

function headRepositoryFullName(repository: GitHubPullRequest["head"]["repo"]): string | null {
	return repository === null ? null : repository.full_name;
}

function getPullRequestIgnoreReason(
	pullRequest: GitHubPullRequest,
	headSha: string,
): ReviewRunIgnoreReason | null {
	if (pullRequest.state !== "open") {
		return "closed_pull_request";
	}
	if (pullRequest.draft) {
		return "draft_pull_request";
	}
	return pullRequest.head.sha === headSha ? null : "superseded_head_sha";
}

function createCompleteReviewChunks(
	diff: string,
	expectedFiles: number,
): readonly ReviewInputChunk[] {
	const chunks = createReviewInputChunks(diff);
	const receivedFiles = new Set(chunks.flatMap((chunk) => [...chunk.changedLines.keys()]));
	if (receivedFiles.size !== expectedFiles)
		throw new Error("GitHub returned an incomplete diff.");
	return chunks;
}

export function createReviewInputChunks(diff: string): readonly ReviewInputChunk[] {
	if (diff === "") return [];
	const blocks = diff.split(/(?=^diff --git )/m);
	return blocks.map((block, index) => {
		const file = parseFileBlock(block);
		return {
			changedLines: fileChangedLines(file, resolveFilePath(file)),
			diff: block,
			referenceBefore: "",
			referenceAfter: "",
			index: index + 1,
			total: blocks.length,
		};
	});
}

function parseFileBlock(diff: string): File {
	const files = parseDiff(diff);
	if (!diff.startsWith("diff --git ") || files.length !== 1)
		throw new Error("Invalid Git diff file block.");
	return files[0]!;
}

function resolveFilePath(file: File): string {
	const from = repositoryFilePath(file.from);
	const to = repositoryFilePath(file.to);
	const path = to ?? from;
	if (path === null) throw new Error("Git diff file path unavailable.");
	return path;
}

function repositoryFilePath(path: string | undefined): string | null {
	if (path === undefined || path === "/dev/null") return null;
	const decoded = decodeGitDiffPath(path);
	if (!isRepositoryPath(decoded)) throw new Error("Invalid Git diff repository path.");
	return decoded;
}

function fileChangedLines(file: File, path: string): ReadonlyMap<string, ReadonlySet<number>> {
	const lines = new Set<number>();
	for (const hunk of file.chunks) {
		for (const change of hunk.changes) {
			if (change.type === "add") lines.add(change.ln);
		}
	}
	return new Map([[path, lines]]);
}

function inputRequest<A>(
	request: (signal: AbortSignal) => Promise<A>,
	signal: AbortSignal,
	recordMetric: ReviewMetricRecorder,
): Promise<A> {
	return Effect.runPromise(
		githubContextRequests.withPermit(
			observeGitHubContextRequest(
				Effect.tryPromise({
					try: request,
					catch: () => new Error("GitHub input request failed."),
				}),
				recordMetric,
			),
		),
		{ signal },
	);
}
async function availableInputTokenLimit(
	request: GitHubReviewInputOptions["getInputTokenLimit"],
	model: string,
	signal: AbortSignal,
): Promise<number | null> {
	try {
		return z
			.number()
			.int()
			.positive()
			.parse(await request(model, signal));
	} catch {
		return null;
	}
}
