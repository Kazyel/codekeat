import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const artifactDirectories: string[] = [];
afterEach(() => {
	for (const directory of artifactDirectories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

import { createReviewInputChunks, GitHubReviewInputService } from "#features/github";
import type { RunnableReviewRun } from "#features/review";
import type { GitHubSourceGitApi } from "../src/features/github/services/github-source-catalog.service.js";
import { createReviewFindingJudgeBatches } from "../src/features/review/utils/review-finding-evidence.util.js";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

describe("createReviewInputChunks", () => {
	it("maps added lines to their complete file", () => {
		const chunks = createReviewInputChunks(SAMPLE_DIFF);

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.changedLines.get("src/example.ts")).toEqual(new Set([2, 3]));
		expect(chunks[0]?.diff).toContain("+export const retries = 3;");
		expect(chunks[0]).toMatchObject({ index: 1, total: 1 });
	});

	it("keeps a large line and hunk intact for the generator and judge", () => {
		const largeLine = "x".repeat(100_100);
		const chunks = createReviewInputChunks(
			`diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -0,0 +1 @@\n+${largeLine}\n`,
		);

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.diff).toContain(`+${largeLine}\n`);
		expect(chunks[0]?.changedLines.get("src/example.ts")).toEqual(new Set([1]));
	});

	it("keeps files separate without arbitrary neighboring fragments", () => {
		const chunks = createReviewInputChunks(
			[
				createLargeFileDiff("first.ts"),
				createLargeFileDiff("second.ts"),
				createLargeFileDiff("third.ts"),
			].join(""),
		);

		expect(chunks).toHaveLength(3);
		expect(
			chunks.every((chunk) => chunk.referenceBefore === "" && chunk.referenceAfter === ""),
		).toBe(true);
		expect(chunks[1]?.changedLines.has("first.ts")).toBe(false);
		expect(chunks[1]?.changedLines.has("third.ts")).toBe(false);
	});

	it("preserves raw rename, mode and index metadata for each complete file", () => {
		const renamed = [
			'diff --git "a/src/old name.ts" "b/src/new name.ts"',
			"old mode 100644",
			"new mode 100755",
			"similarity index 90%",
			"rename from src/old name.ts",
			"rename to src/new name.ts",
			"index 1111111..2222222",
			'--- "a/src/old name.ts"',
			'+++ "b/src/new name.ts"',
			"@@ -1 +1,2 @@",
			" old",
			"+new",
			"",
		].join("\n");
		const chunks = createReviewInputChunks(renamed + SAMPLE_DIFF);

		expect(chunks.map((chunk) => chunk.diff)).toEqual([renamed, SAMPLE_DIFF]);
		expect(chunks[0]?.changedLines.get("src/new name.ts")).toEqual(new Set([2]));
	});

	it.each([
		String.raw`src/bad\q.ts`,
		String.raw`src/bad\30.ts`,
		String.raw`src/bad\777.ts`,
		String.raw`src/bad\377.ts`,
	])("rejects an invalid Git path escape or UTF8 sequence in %s", (path) => {
		expect(() => createReviewInputChunks(createSmallFileDiff(path))).toThrow(
			/Invalid Git diff path encoding|The encoded data was not valid/,
		);
	});

	it("rejects an unrecognized diff prefix instead of dropping source data", () => {
		expect(() => createReviewInputChunks(`unexpected metadata\n${SAMPLE_DIFF}`)).toThrow(
			"Invalid Git diff file block.",
		);
	});

	it("preserves late added lines when the same hunk becomes judge evidence", () => {
		const lines = Array.from(
			{ length: 2_000 },
			(_, index) => `+line-${index}-${"x".repeat(95)}`,
		);
		const chunks = createReviewInputChunks(
			[
				"diff --git a/large.ts b/large.ts",
				"--- a/large.ts",
				"+++ b/large.ts",
				"@@ -0,0 +1,2000 @@",
				...lines,
				"",
			].join("\n"),
		);
		const chunk = chunks.find((entry) => entry.changedLines.get("large.ts")?.has(1_900))!;
		const batches = createReviewFindingJudgeBatches([
			{
				chunk,
				finding: {
					path: "large.ts",
					line: 1_900,
					severity: "high",
					title: "A reachable defect",
					rationale: "The added line introduces a defect.",
				},
				investigation: { kind: "not_enabled" },
			},
		]);

		expect(chunks).toHaveLength(1);
		expect(batches?.[0]?.input.evidence[0]?.diff).toContain(lines[1_899]);
		expect(batches?.[0]?.findings[0]?.line).toBe(1_900);
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

const QUOTED_UTF8_DIFF = String.raw`diff --git "a/src/caf\303\251.ts" "b/src/caf\303\251.ts"
index 1111111..2222222 100644
--- "a/src/caf\303\251.ts"
+++ "b/src/caf\303\251.ts"
@@ -1 +1,2 @@
 old
+new
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
	it.each(["", SAMPLE_DIFF])("rejects incomplete diffs before fetching context", async (diff) => {
		const { database, app, service, run } = createInputFixture(
			{ ...REMOTE_PULL_REQUEST, changed_files: 2 },
			{ diff },
		);

		expect(await service.load(run)).toEqual({
			kind: "failed",
			errorCode: "github_diff_unavailable",
		});
		expect(app.blobRequests).toEqual([]);
		database.close();
	});
	it("reads Git quoted UTF8 paths at the head SHA and anchors the same path for the judge", async () => {
		const { database, app, service, run } = createInputFixture(REMOTE_PULL_REQUEST, {
			diff: QUOTED_UTF8_DIFF,
			contentResults: new Map([["src/café.ts", githubTextFile("old\nnew\n")]]),
		});
		const result = await service.load(run);
		if (result.kind !== "ready") throw new Error("Expected review input");
		const chunk = result.input.chunks[0]!;
		expect(chunk.changedLines.get("src/café.ts")).toEqual(new Set([2]));
		expect(result.input.repositoryContext.files).toContainEqual({
			kind: "loaded",
			path: "src/café.ts",
			content: "old\nnew\n",
		});
		expect(app.blobRequests).toContainEqual(
			expect.objectContaining({
				file_sha: gitBlobSha(Buffer.from("old\nnew\n")),
			}),
		);
		expect(
			createReviewFindingJudgeBatches([
				{
					chunk,
					finding: {
						path: "src/café.ts",
						line: 2,
						severity: "high",
						title: "Concrete failure",
						rationale: "The changed line fails in a reachable scenario.",
					},
					investigation: { kind: "not_enabled" },
				},
			])?.[0]?.findings[0]?.path,
		).toBe("src/café.ts");
		database.close();
	});
	it("loads reviewable changed lines for an accessible open pull request", async () => {
		const { database, service, run } = createInputFixture();

		const result = await service.load(run);

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") {
			throw new Error("Expected review input");
		}
		expect(result.input.chunks[0]?.changedLines.get("src/example.ts")).toEqual(new Set([2, 3]));
		expect(result.input.repositoryContext.files).toEqual([
			...ROOT_MISSING_DOCUMENTS,
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
						...ROOT_MISSING_DOCUMENTS,
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
		expect(app.blobRequests).toHaveLength(2);
		expect(
			app.blobRequests.every(
				(request) => request.owner === "contributor" && request.repo === "codekeat",
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
						...ROOT_MISSING_DOCUMENTS.map((file) => ({
							...file,
							kind: "unavailable",
							reason: "head_repository_unavailable",
						})),
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
		expect(app.blobRequests).toEqual([]);
		database.close();
	});

	it("loads entire documents and changed files beyond the former context limits", async () => {
		const paths = [
			".codekeat/README.md",
			".codekeat/domain.md",
			".codekeat/integrations.md",
			"first.ts",
			"second.ts",
			"third.ts",
		];
		const { database, app, service, run } = createInputFixture(
			{ ...REMOTE_PULL_REQUEST, changed_files: paths.length },
			{
				diff: paths.map(createSmallFileDiff).join(""),
				contentResults: new Map(
					paths.map((path) => [path, githubTextFile("x".repeat(25_000))]),
				),
			},
		);

		const result = await service.load(run);

		if (result.kind !== "ready") {
			throw new Error("Expected review input");
		}
		expect(result.input.repositoryContext.omittedFileCount).toBe(0);
		expect(
			result.input.repositoryContext.files
				.filter((file) => paths.includes(file.path))
				.map((file) => ({
					path: file.path,
					kind: file.kind,
					length: file.kind === "loaded" ? file.content.length : 0,
				})),
		).toEqual(paths.map((path) => ({ path, kind: "loaded", length: 25_000 })));
		expect(app.blobRequests).toHaveLength(6);
		database.close();
	});

	it("keeps large and unknown-size sources reachable without treating lazy context as missing", async () => {
		const content = "é".repeat(550_000);
		const { database, app, service, run } = createInputFixture(REMOTE_PULL_REQUEST, {
			contentResults: new Map([["src/example.ts", githubTextFile(content)]]),
			inputTokenLimit: 1_000,
		});
		const result = await service.load(run);
		if (result.kind !== "ready" || result.sources === null) throw new Error("Expected catalog");
		expect(result.input.repositoryContext.files).toContainEqual(
			expect.objectContaining({ kind: "catalog", path: "src/example.ts" }),
		);
		expect(app.blobRequests).toEqual([]);
		expect(
			await result.sources.read(
				{
					source: { role: "head", path: "src/example.ts" },
					range: { kind: "lines", startLine: 1, lineCount: 1 },
				},
				new AbortController().signal,
			),
		).toMatchObject({ kind: "loaded", content });
		expect(app.blobRequests).toMatchObject([
			{
				owner: "takeat",
				repo: "codekeat",
				file_sha: gitBlobSha(Buffer.from(content)),
			},
		]);
		database.close();
	});

	it("reports tree discovery failure explicitly and cancels before starting context I/O", async () => {
		const { database, app, service, run } = createInputFixture(REMOTE_PULL_REQUEST, {
			treeError: new Error("Forbidden"),
		});
		expect(await service.load(run)).toMatchObject({
			kind: "ready",
			input: {
				repositoryContext: {
					files: expect.arrayContaining([
						{ kind: "unavailable", path: "src/example.ts", reason: "request_failed" },
					]),
				},
			},
		});
		const controller = new AbortController();
		controller.abort();
		expect(await service.load(run, controller.signal)).toEqual({
			kind: "failed",
			errorCode: "github_diff_unavailable",
		});
		expect(app.blobRequests).toEqual([]);
		database.close();
	});

	it("loads nested documentation and verified local imports from the complete manifest", async () => {
		const files = new Map([
			[".codekeat/flows/orders.md", githubTextFile("Order invariants\n".repeat(3_000))],
			[
				"src/example.ts",
				githubTextFile(
					'import { validate } from "./validation.js";\nimport bad from "../../../../private";\n',
				),
			],
			["src/validation.ts", githubTextFile("export const validate = () => true;")],
			["src/example.test.ts", githubTextFile("expect(validate()).toBe(true);")],
		]);
		const { database, app, service, run } = createInputFixture(REMOTE_PULL_REQUEST, {
			contentResults: files,
		});
		const result = await service.load(run);
		if (result.kind !== "ready") throw new Error("Expected review input");
		expect(result.input.repositoryContext.files).toEqual(
			expect.arrayContaining(
				[...files].map(([path, file]) => ({
					kind: "loaded",
					path,
					content: Buffer.from(file.content, "base64").toString(),
				})),
			),
		);
		expect(app.blobRequests.map((request) => request.file_sha).sort()).toEqual(
			[...files.values()]
				.map((file) => gitBlobSha(Buffer.from(file.content, "base64")))
				.sort(),
		);
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
			expect(app.blobRequests).toEqual([]);
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
	readonly blobRequests: Parameters<GitHubSourceGitApi["getBlob"]>[0][] = [];

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
					compareCommitsWithBasehead: async () => ({
						data: { merge_base_commit: { sha: "b".repeat(40) } },
					}),
				},
				git: {
					getCommit: async ({ commit_sha }: { commit_sha: string }) => ({
						data: { sha: commit_sha, tree: { sha: "d".repeat(40) } },
					}),
					getTree: async () => {
						if (this.options.treeError !== undefined) throw this.options.treeError;
						return {
							data: {
								sha: "d".repeat(40),
								truncated: false,
								tree: [...this.files()].map(([path, file]) => ({
									path,
									sha: gitBlobSha(Buffer.from(file.content, "base64")),
									type: "blob",
									mode: "100644",
									size: file.size,
								})),
							},
						};
					},
					getBlob: async (location: {
						owner: string;
						repo: string;
						file_sha: string;
						request: { signal: AbortSignal };
					}) => {
						this.blobRequests.push(location);
						location.request.signal.throwIfAborted();
						const match = [...this.files()].find(
							([, file]) =>
								gitBlobSha(Buffer.from(file.content, "base64")) ===
								location.file_sha,
						);
						if (match === undefined) throw new Error("Unknown fixture blob");
						const [, file] = match;
						return {
							data: {
								sha: location.file_sha,
								encoding: "base64",
								content: file.content,
								size: file.size,
							},
						};
					},
				},
			},
			request: async () => {
				this.diffRequests += 1;
				return { data: this.options.diff ?? SAMPLE_DIFF };
			},
		};
	}
	private files(): ReadonlyMap<string, z.infer<typeof FIXTURE_FILE_SCHEMA>> {
		return new Map(
			[...(this.options.contentResults ?? new Map())].map(([path, data]) => [
				path,
				FIXTURE_FILE_SCHEMA.parse(data),
			]),
		);
	}
}

interface ReviewInputFixtureOptions {
	readonly diff?: string;
	readonly contentResults?: ReadonlyMap<string, unknown>;
	readonly inputTokenLimit?: number;
	readonly treeError?: Error;
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
	const artifactDirectory = mkdtempSync(join(tmpdir(), "codekeat-input-"));
	artifactDirectories.push(artifactDirectory);
	return {
		database,
		app,
		service: new GitHubReviewInputService(app, database.githubAccessRepository, {
			artifactDirectory,
			getInputTokenLimit: async () => options.inputTokenLimit ?? 1_000_000,
		}),
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

const FIXTURE_FILE_SCHEMA = z.object({
	type: z.literal("file"),
	encoding: z.literal("base64"),
	content: z.string(),
	size: z.number().int().nonnegative(),
});
const ROOT_MISSING_DOCUMENTS = ["AGENTS.md", "README.md", ".codekeat.yml"].map((path) => ({
	kind: "missing",
	path,
}));
function gitBlobSha(bytes: Buffer): string {
	return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
