import { describe, expect, it } from "vitest";

import {
	createReviewInputChunks,
	GitHubReviewInputService,
	MAXIMUM_REVIEW_CHUNK_LENGTH,
} from "#features/github";
import type { RunnableReviewRun } from "#features/review";
import type { GitHubReviewContentLocation } from "../src/features/github/services/github-review-context.service.js";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

describe("createReviewInputChunks", () => {
	it("maps added lines to their file and keeps chunks below the limit", () => {
		const chunks = createReviewInputChunks(SAMPLE_DIFF);

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.changedLines.get("src/example.ts")).toEqual(new Set([2, 3]));
		expect(chunks[0]?.diff.length).toBeLessThanOrEqual(MAXIMUM_REVIEW_CHUNK_LENGTH);
		expect(chunks[0]).toMatchObject({ index: 1, total: 1 });
	});

	it("splits a large hunk without losing its added line mapping", () => {
		const largeLine = "x".repeat(MAXIMUM_REVIEW_CHUNK_LENGTH + 100);
		const chunks = createReviewInputChunks(
			`diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +1 @@\n+${largeLine}\n`,
		);

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.diff.length <= MAXIMUM_REVIEW_CHUNK_LENGTH)).toBe(
			true,
		);
		expect(chunks.every((chunk) => chunk.changedLines.get("src/example.ts")?.has(1))).toBe(
			true,
		);
	});

	it("adds line-aligned context from only the immediate neighboring chunks", () => {
		const chunks = createReviewInputChunks(
			[
				createLargeFileDiff("first.ts"),
				createLargeFileDiff("second.ts"),
				createLargeFileDiff("third.ts"),
			].join(""),
		);

		expect(chunks).toHaveLength(3);
		expect(chunks[0]?.referenceBefore).toBe("");
		expect(chunks[0]?.referenceAfter).toBe(
			chunks[1]?.diff.slice(0, chunks[0].referenceAfter.length),
		);
		expect(chunks[1]?.referenceBefore).toBe(
			chunks[0]?.diff.slice(-chunks[1].referenceBefore.length),
		);
		expect(chunks[1]?.referenceAfter).toBe(
			chunks[2]?.diff.slice(0, chunks[1].referenceAfter.length),
		);
		expect(chunks[2]?.referenceAfter).toBe("");
		expect(
			chunks.every(
				(chunk) =>
					chunk.referenceBefore.length <= 4_000 &&
					chunk.referenceAfter.length <= 4_000 &&
					(chunk.referenceBefore === "" || chunk.referenceBefore.endsWith("\n")) &&
					(chunk.referenceAfter === "" || chunk.referenceAfter.endsWith("\n")),
			),
		).toBe(true);
		expect(chunks[1]?.changedLines.has("first.ts")).toBe(false);
		expect(chunks[1]?.changedLines.has("third.ts")).toBe(false);
	});
});

const SAMPLE_DIFF = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1,3 @@
 export const value = 1;
+export const enabled = true;
+export const retries = 3;
`;

function createLargeFileDiff(path: string): string {
	const lines = Array.from(
		{ length: 600 },
		(_, index) => `+${path}-${index}-${"x".repeat(90)}\n`,
	).join("");
	return (
		[
			`diff --git a/${path} b/${path}`,
			`--- a/${path}`,
			`+++ b/${path}`,
			"@@ -0,0 +1,600 @@",
			"",
		].join("\n") + lines
	);
}

const REMOTE_PULL_REQUEST = {
	base: { repo: { id: 20 }, sha: "c".repeat(40) },
	body: null,
	changed_files: 1,
	draft: false,
	head: { sha: "a".repeat(40), repo: { full_name: "takeat/codekeat" } },
	state: "open",
	title: "Review this change",
};

describe("GitHubReviewInputService", () => {
	it("loads reviewable changed lines for an accessible open pull request", async () => {
		const { database, service, run } = createInputFixture();

		const result = await service.load(run);

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") {
			throw new Error("Expected review input");
		}
		expect(result.input.chunks[0]?.changedLines.get("src/example.ts")).toEqual(new Set([2, 3]));
		expect(result.input.repositoryContext.files).toEqual([
			{ kind: "missing", path: ".codekeat/README.md" },
			{ kind: "missing", path: ".codekeat/domain.md" },
			{ kind: "missing", path: ".codekeat/integrations.md" },
			{ kind: "missing", path: "src/example.ts" },
		]);
		database.close();
	});

	it("loads documentation and full changed files from the fork at the reviewed SHA", async () => {
		const { database, app, service, run } = createInputFixture(
			{
				...REMOTE_PULL_REQUEST,
				body: "Validate incoming orders",
				head: { ...REMOTE_PULL_REQUEST.head, repo: { full_name: "contributor/codekeat" } },
			},
			{
				contentResults: new Map([
					[".codekeat/README.md", githubTextFile("Order workflow")],
					[
						"src/example.ts",
						githubTextFile("export const value = 1;\nexport const enabled = true;\n"),
					],
				]),
			},
		);

		const result = await service.load(run);

		expect(result).toMatchObject({
			kind: "ready",
			input: {
				body: "Validate incoming orders",
				baseSha: "c".repeat(40),
				repositoryContext: {
					repositoryFullName: "contributor/codekeat",
					revision: run.headSha,
					omittedFileCount: 0,
					files: [
						{ kind: "loaded", path: ".codekeat/README.md", content: "Order workflow" },
						{ kind: "missing", path: ".codekeat/domain.md" },
						{ kind: "missing", path: ".codekeat/integrations.md" },
						{
							kind: "loaded",
							path: "src/example.ts",
							content: "export const value = 1;\nexport const enabled = true;\n",
						},
					],
				},
			},
		});
		expect(app.contentRequests).toHaveLength(4);
		expect(
			app.contentRequests.every(
				(request) =>
					request.owner === "contributor" &&
					request.repo === "codekeat" &&
					request.ref === run.headSha,
			),
		).toBe(true);
		database.close();
	});

	it("reports a deleted head repository without reading the base branch", async () => {
		const { database, app, service, run } = createInputFixture({
			...REMOTE_PULL_REQUEST,
			head: { ...REMOTE_PULL_REQUEST.head, repo: null },
		});

		const result = await service.load(run);

		expect(result).toMatchObject({
			kind: "ready",
			input: {
				repositoryContext: {
					repositoryFullName: null,
					files: [
						{
							kind: "unavailable",
							path: ".codekeat/README.md",
							reason: "head_repository_unavailable",
						},
						{
							kind: "unavailable",
							path: ".codekeat/domain.md",
							reason: "head_repository_unavailable",
						},
						{
							kind: "unavailable",
							path: ".codekeat/integrations.md",
							reason: "head_repository_unavailable",
						},
						{
							kind: "unavailable",
							path: "src/example.ts",
							reason: "head_repository_unavailable",
						},
					],
				},
			},
		});
		expect(app.contentRequests).toEqual([]);
		database.close();
	});

	it.each([
		{
			name: "permission error",
			response: Object.assign(new Error("Forbidden"), { status: 403 }),
			reason: "request_failed",
		},
		{ name: "directory", response: [], reason: "invalid_response" },
		{
			name: "symlink",
			response: { type: "symlink", target: "example.ts" },
			reason: "invalid_response",
		},
		{
			name: "submodule reported as file",
			response: {
				...githubTextFile("example"),
				submodule_git_url: "https://github.com/example/submodule",
			},
			reason: "invalid_response",
		},
		{
			name: "malformed base64",
			response: { ...githubTextFile("example"), content: "!!!" },
			reason: "invalid_response",
		},
		{
			name: "noncanonical base64",
			response: { ...githubTextFile("a"), content: "YR==" },
			reason: "invalid_response",
		},
		{
			name: "binary file",
			response: githubTextFile("\u0000binary"),
			reason: "invalid_response",
		},
		{
			name: "size mismatch",
			response: { ...githubTextFile("example"), size: 0 },
			reason: "invalid_response",
		},
		{
			name: "invalid utf8",
			response: { type: "file", encoding: "base64", content: "/w==", size: 1 },
			reason: "invalid_response",
		},
	])("distinguishes $name from missing context", async ({ response, reason }) => {
		const { database, service, run } = createInputFixture(REMOTE_PULL_REQUEST, {
			contentResults: new Map([[".codekeat/README.md", response]]),
		});

		expect(await service.load(run)).toMatchObject({
			kind: "ready",
			input: {
				repositoryContext: {
					files: [
						{ kind: "unavailable", path: ".codekeat/README.md", reason },
						{ kind: "missing", path: ".codekeat/domain.md" },
						{ kind: "missing", path: ".codekeat/integrations.md" },
						{ kind: "missing", path: "src/example.ts" },
					],
				},
			},
		});
		database.close();
	});

	it("bounds total context and explicitly marks partial files and omitted code", async () => {
		const paths = [
			".codekeat/README.md",
			".codekeat/domain.md",
			".codekeat/integrations.md",
			"first.ts",
			"second.ts",
			"third.ts",
		];
		const { database, app, service, run } = createInputFixture(REMOTE_PULL_REQUEST, {
			diff: paths.map(createSmallFileDiff).join(""),
			contentResults: new Map(
				paths.map((path) => [path, githubTextFile("x".repeat(25_000))]),
			),
		});

		const result = await service.load(run);

		if (result.kind !== "ready") {
			throw new Error("Expected review input");
		}
		expect(result.input.repositoryContext.omittedFileCount).toBe(1);
		expect(
			result.input.repositoryContext.files.map((file) => ({
				path: file.path,
				kind: file.kind,
				length:
					file.kind === "loaded" || file.kind === "truncated" ? file.content.length : 0,
			})),
		).toEqual([
			{ path: ".codekeat/README.md", kind: "truncated", length: 12_000 },
			{ path: ".codekeat/domain.md", kind: "truncated", length: 12_000 },
			{ path: ".codekeat/integrations.md", kind: "truncated", length: 12_000 },
			{ path: "first.ts", kind: "truncated", length: 24_000 },
			{ path: "second.ts", kind: "truncated", length: 4_000 },
		]);
		expect(app.contentRequests).toHaveLength(5);
		database.close();
	});

	it("limits requests, deduplicates changed paths and ignores files without added lines", async () => {
		const paths = Array.from({ length: 11 }, (_, index) => `file-${index}.ts`);
		const deletedFileDiff =
			"diff --git a/deleted.ts b/deleted.ts\n--- a/deleted.ts\n+++ b/deleted.ts\n@@ -1 +0,0 @@\n-removed\n";
		const { database, app, service, run } = createInputFixture(REMOTE_PULL_REQUEST, {
			diff:
				[...paths, paths[0]!, ".codekeat/README.md"].map(createSmallFileDiff).join("") +
				deletedFileDiff,
		});

		const result = await service.load(run);

		expect(result).toMatchObject({
			kind: "ready",
			input: { repositoryContext: { omittedFileCount: 2 } },
		});
		expect(app.contentRequests).toHaveLength(12);
		expect(app.contentRequests.map((request) => request.path)).toEqual([
			".codekeat/README.md",
			".codekeat/domain.md",
			".codekeat/integrations.md",
			...paths.slice(0, 9),
		]);
		database.close();
	});

	it.each([
		{ state: "closed", draft: false, ignoreReason: "closed_pull_request" },
		{ state: "open", draft: true, ignoreReason: "draft_pull_request" },
	])(
		"ignores a remotely $state/draft=$draft pull request before loading its diff",
		async ({ state, draft, ignoreReason }) => {
			const { database, app, service, run } = createInputFixture({
				...REMOTE_PULL_REQUEST,
				state,
				draft,
			});

			expect(await service.load(run)).toEqual({ kind: "ignored", ignoreReason });
			expect(app.diffRequests).toBe(0);
			database.close();
		},
	);

	it("does not load a newer pull request revision for an older queued review", async () => {
		const { database, app, service, run } = createInputFixture({
			...REMOTE_PULL_REQUEST,
			head: { ...REMOTE_PULL_REQUEST.head, sha: "b".repeat(40) },
		});

		expect(await service.load(run)).toEqual({
			kind: "ignored",
			ignoreReason: "superseded_head_sha",
		});
		expect(app.diffRequests).toBe(0);
		database.close();
	});

	it.each([
		{
			revision: "head",
			pullRequestAfterDiff: {
				...REMOTE_PULL_REQUEST,
				head: { ...REMOTE_PULL_REQUEST.head, sha: "b".repeat(40) },
			},
			ignoreReason: "superseded_head_sha",
		},
		{
			revision: "base",
			pullRequestAfterDiff: {
				...REMOTE_PULL_REQUEST,
				base: { ...REMOTE_PULL_REQUEST.base, sha: "d".repeat(40) },
			},
			ignoreReason: "superseded_base_sha",
		},
	])(
		"discards a diff fetched while the PR $revision changes before loading context",
		async ({ pullRequestAfterDiff, ignoreReason }) => {
			const { database, app, service, run } = createInputFixture(REMOTE_PULL_REQUEST, {
				pullRequestAfterDiff,
			});
			expect(await service.load(run)).toEqual({ kind: "ignored", ignoreReason });
			expect(app.diffRequests).toBe(1);
			expect(app.contentRequests).toEqual([]);
			database.close();
		},
	);

	it("rejects access removed after the review was queued even if GitHub returns the PR", async () => {
		const { database, app, service, run } = createInputFixture();
		database.githubAccessRepository.setRepositoryStatus(20, "removed");

		expect(await service.load(run)).toEqual({
			kind: "ignored",
			ignoreReason: "repository_not_active",
		});
		expect(database.githubAccessRepository.findRepository(20, 10)?.status).toBe("removed");
		expect(app.diffRequests).toBe(0);
		database.close();
	});

	it("rejects a suspended installation even when its repository remains active", async () => {
		const { database, app, service, run } = createInputFixture();
		database.githubAccessRepository.setInstallationStatus(10, "suspended");

		expect(await service.load(run)).toEqual({
			kind: "ignored",
			ignoreReason: "installation_not_active",
		});
		expect(app.diffRequests).toBe(0);
		database.close();
	});

	it("does not accept an unknown repository from the remote pull request response", async () => {
		const { database, app, service, run } = createInputFixture({
			...REMOTE_PULL_REQUEST,
			base: { ...REMOTE_PULL_REQUEST.base, repo: { id: 21 } },
		});

		expect(await service.load(run)).toEqual({
			kind: "ignored",
			ignoreReason: "repository_not_active",
		});
		expect(database.githubAccessRepository.findRepository(21, 10)).toBeNull();
		expect(app.diffRequests).toBe(0);
		database.close();
	});

	it("does not use another installation's active repository to load review input", async () => {
		const { database, app, service, run } = createInputFixture();
		database.githubAccessRepository.upsertInstallation({
			githubInstallationId: 11,
			accountLogin: "takeat",
			status: "active",
		});

		expect(await service.load({ ...run, githubInstallationId: 11 })).toEqual({
			kind: "ignored",
			ignoreReason: "repository_not_active",
		});
		expect(app.diffRequests).toBe(0);
		database.close();
	});

	it("fails closed when GitHub does not provide a valid pull request state", async () => {
		const { database, app, service, run } = createInputFixture({
			...REMOTE_PULL_REQUEST,
			draft: undefined,
		});

		expect(await service.load(run)).toEqual({
			kind: "failed",
			errorCode: "github_diff_unavailable",
		});
		expect(app.diffRequests).toBe(0);
		database.close();
	});
});

class RecordedReviewInputApp {
	diffRequests = 0;
	readonly contentRequests: GitHubReviewContentLocation[] = [];

	constructor(
		private readonly pullRequest: unknown,
		private readonly options: ReviewInputFixtureOptions,
	) {}

	async auth() {
		return {
			rest: {
				pulls: {
					get: async () => ({
						data:
							this.diffRequests > 0
								? (this.options.pullRequestAfterDiff ?? this.pullRequest)
								: this.pullRequest,
					}),
				},
				repos: {
					getContent: async (location: GitHubReviewContentLocation) => {
						this.contentRequests.push(location);
						if (!this.options.contentResults?.has(location.path)) {
							throw Object.assign(new Error("Not found"), { status: 404 });
						}
						const data = this.options.contentResults.get(location.path);
						if (data instanceof Error) {
							throw data;
						}
						return { data };
					},
				},
			},
			request: async () => {
				this.diffRequests += 1;
				return { data: this.options.diff ?? SAMPLE_DIFF };
			},
		};
	}
}

interface ReviewInputFixtureOptions {
	readonly diff?: string;
	readonly contentResults?: ReadonlyMap<string, unknown>;
	readonly pullRequestAfterDiff?: unknown;
}

function createInputFixture(
	pullRequest: unknown = REMOTE_PULL_REQUEST,
	options: ReviewInputFixtureOptions = {},
): {
	readonly database: TestDatabase;
	readonly app: RecordedReviewInputApp;
	readonly service: GitHubReviewInputService;
	readonly run: RunnableReviewRun;
} {
	const database = createTestDatabase();
	database.githubAccessRepository.upsertInstallation({
		githubInstallationId: 10,
		accountLogin: "takeat",
		status: "active",
	});
	database.githubAccessRepository.upsertRepository({
		githubRepositoryId: 20,
		installationId: 10,
		ownerLogin: "takeat",
		name: "codekeat",
		defaultBranch: "main",
		status: "active",
	});
	const app = new RecordedReviewInputApp(pullRequest, options);
	return {
		database,
		app,
		service: new GitHubReviewInputService(app, database.githubAccessRepository),
		run: {
			id: "review-run-1",
			githubInstallationId: 10,
			githubInstallationAccountLogin: "takeat",
			repositoryOwner: "takeat",
			repositoryName: "codekeat",
			repositoryFullName: "takeat/codekeat",
			pullRequestNumber: 30,
			headSha: "a".repeat(40),
			model: database.selectedModel,
		},
	};
}

function githubTextFile(content: string): {
	readonly type: "file";
	readonly encoding: "base64";
	readonly content: string;
	readonly size: number;
} {
	return {
		type: "file",
		encoding: "base64",
		content: Buffer.from(content).toString("base64"),
		size: Buffer.byteLength(content),
	};
}

function createSmallFileDiff(path: string): string {
	return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
}
