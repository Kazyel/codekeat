import parseDiff, { type Change, type Chunk, type File } from "parse-diff";
import { z } from "zod";

import type {
	ReviewInputChunk,
	ReviewInputLoadResult,
	ReviewInputSource,
	RunnableReviewRun,
	ReviewRunIgnoreReason,
} from "#features/review";
import {
	MAXIMUM_PULL_REQUEST_FILES,
	MAXIMUM_REVIEW_CHUNK_LENGTH,
} from "../constants/github.constants.js";
import type { GitHubAccessRepository } from "../repositories/github-access.repository.js";
import {
	type GitHubReviewContentSource,
	loadGitHubReviewContext,
} from "./github-review-context.service.js";
const MAXIMUM_ADJACENT_REFERENCE_LENGTH = 4_000;

interface DiffSection {
	readonly changedLines: ReadonlyMap<string, ReadonlySet<number>>;
	readonly diff: string;
}

const PULL_REQUEST_SCHEMA = z.object({
	base: z.object({
		repo: z.object({ id: z.number().int().positive() }),
		sha: z.string().min(1),
	}),
	body: z.string().nullable(),
	changed_files: z.number().int().nonnegative(),
	draft: z.boolean(),
	head: z.object({
		sha: z.string().min(1),
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
};

interface GitHubReviewInputApp {
	auth(githubInstallationId: number): Promise<{
		readonly rest: {
			readonly repos: GitHubReviewContentSource;
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

export class GitHubReviewInputService implements ReviewInputSource {
	constructor(
		private readonly app: GitHubReviewInputApp,
		private readonly accessRepository: GitHubAccessRepository,
	) {}

	async load(run: RunnableReviewRun): Promise<ReviewInputLoadResult> {
		try {
			const octokit = await this.app.auth(run.githubInstallationId);

			const location = {
				owner: run.repositoryOwner,
				repo: run.repositoryName,
				pull_number: run.pullRequestNumber,
			};
			const response = await octokit.rest.pulls.get(location);
			const pullRequest = PULL_REQUEST_SCHEMA.parse(response.data);
			const ignoreReason = this.getInputIgnoreReason(pullRequest, run);
			if (ignoreReason !== null) {
				return { kind: "ignored", ignoreReason };
			}

			if (pullRequest.changed_files > MAXIMUM_PULL_REQUEST_FILES) {
				return { kind: "failed", errorCode: "github_diff_file_limit_exceeded" };
			}

			const diffResponse = await octokit.request(
				"GET /repos/{owner}/{repo}/pulls/{pull_number}",
				{
					...location,
					headers: { accept: "application/vnd.github.diff" },
				},
			);

			const diff = z.string().parse(diffResponse.data);
			const currentResponse = await octokit.rest.pulls.get(location);
			const currentPullRequest = PULL_REQUEST_SCHEMA.parse(currentResponse.data);
			const currentIgnoreReason = this.getSnapshotIgnoreReason(
				pullRequest,
				currentPullRequest,
				run,
			);
			if (currentIgnoreReason !== null) {
				return { kind: "ignored", ignoreReason: currentIgnoreReason };
			}
			const chunks = createReviewInputChunks(diff);
			const repositoryContext = await loadGitHubReviewContext(
				octokit.rest.repos,
				headRepositoryFullName(pullRequest.head.repo),
				run.headSha,
				chunks,
			);

			return {
				kind: "ready",
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

export function createReviewInputChunks(diff: string): readonly ReviewInputChunk[] {
	const sections = parseDiff(diff).flatMap(createFileSections);
	const packedSections = packSections(sections);
	return packedSections.map((section, index) => ({
		changedLines: section.changedLines,
		diff: section.diff,
		referenceBefore: takeTrailingLines(packedSections[index - 1]?.diff ?? ""),
		referenceAfter: takeLeadingLines(packedSections[index + 1]?.diff ?? ""),
		index: index + 1,
		total: packedSections.length,
	}));
}

function createFileSections(file: File): readonly DiffSection[] {
	const path = resolveFilePath(file);
	if (path === null) {
		return [];
	}
	return file.chunks.flatMap((chunk) => splitChunk(path, chunk));
}

function resolveFilePath(file: File): string | null {
	const path = file.to ?? file.from;
	if (path === undefined || path === "/dev/null") {
		return null;
	}
	return path;
}

function splitChunk(path: string, chunk: Chunk): readonly DiffSection[] {
	const prefix = createFileHeader(path, chunk.content);
	const sections: DiffSection[] = [];
	let section = createSection(prefix);

	for (const change of chunk.changes) {
		const result = appendChangeWithinLimit(section, prefix, path, change);
		sections.push(...result.completedSections);
		section = result.section;
	}

	return section.diff === prefix ? [] : [...sections, section];
}

function createFileHeader(path: string, hunkHeader: string): string {
	return (
		[`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, hunkHeader].join(
			"\n",
		) + "\n"
	);
}

function createSection(diff: string): DiffSection {
	return { changedLines: new Map(), diff };
}

function wouldExceedLimit(diff: string, line: string): boolean {
	return diff.length > 0 && diff.length + line.length > MAXIMUM_REVIEW_CHUNK_LENGTH;
}

function appendChangeWithinLimit(
	initialSection: DiffSection,
	prefix: string,
	path: string,
	change: Change,
): { readonly completedSections: readonly DiffSection[]; readonly section: DiffSection } {
	const completedSections: DiffSection[] = [];
	const line = `${change.content}\n`;
	let section = initialSection;
	let remainingLine = line;

	while (remainingLine.length > 0) {
		const capacity = MAXIMUM_REVIEW_CHUNK_LENGTH - section.diff.length;
		if (capacity === 0) {
			completedSections.push(section);
			section = createSection(prefix);
			continue;
		}

		const fragment = remainingLine.slice(0, capacity);
		section = appendChange(section, path, change, fragment);
		remainingLine = remainingLine.slice(fragment.length);
	}

	return { completedSections, section };
}

function appendChange(
	section: DiffSection,
	path: string,
	change: Change,
	fragment: string,
): DiffSection {
	const changedLines = new Map(section.changedLines);
	if (change.type === "add") {
		const existingLines = changedLines.get(path) ?? new Set<number>();
		changedLines.set(path, new Set([...existingLines, change.ln]));
	}
	return { changedLines, diff: section.diff + fragment };
}

function packSections(sections: readonly DiffSection[]): readonly DiffSection[] {
	const chunks: DiffSection[] = [];
	let chunk = createSection("");

	for (const section of sections) {
		if (wouldExceedLimit(chunk.diff, section.diff)) {
			chunks.push(chunk);
			chunk = createSection("");
		}
		chunk = mergeSections(chunk, section);
	}

	return chunk.diff === "" ? chunks : [...chunks, chunk];
}

function mergeSections(first: DiffSection, second: DiffSection): DiffSection {
	const changedLines = new Map(first.changedLines);
	for (const [path, lines] of second.changedLines) {
		changedLines.set(path, new Set([...(changedLines.get(path) ?? []), ...lines]));
	}
	return { changedLines, diff: first.diff + second.diff };
}

function takeLeadingLines(value: string): string {
	let result = "";
	for (const line of completeLines(value)) {
		if (result.length + line.length > MAXIMUM_ADJACENT_REFERENCE_LENGTH) {
			break;
		}
		result += line;
	}
	return result;
}

function takeTrailingLines(value: string): string {
	let result = "";
	for (const line of completeLines(value).toReversed()) {
		if (result.length + line.length > MAXIMUM_ADJACENT_REFERENCE_LENGTH) {
			break;
		}
		result = line + result;
	}
	return result;
}

function completeLines(value: string): readonly string[] {
	const lines = value.match(/.*(?:\n|$)/g) ?? [];
	return lines.filter((line) => line.length > 0 && line.endsWith("\n"));
}
