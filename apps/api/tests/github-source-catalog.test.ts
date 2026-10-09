import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
	createGitHubSourceCatalog,
	type GitHubSourceComparisonApi,
	type GitHubSourceGitApi,
	type GitHubSourceSnapshot,
} from "../src/features/github/services/github-source-catalog.service.js";

type CommitRequest = Parameters<GitHubSourceGitApi["getCommit"]>[0];
type TreeRequest = Parameters<GitHubSourceGitApi["getTree"]>[0];
type BlobRequest = Parameters<GitHubSourceGitApi["getBlob"]>[0];
type CompareRequest = Parameters<GitHubSourceComparisonApi["compareCommitsWithBasehead"]>[0];
type TreeEntry = {
	readonly path: string;
	readonly mode: "100644" | "040000" | "120000" | "160000";
	readonly type: "blob" | "tree" | "commit";
	readonly sha: string;
	readonly size?: number;
};
type SourceFile = { readonly path: string; readonly content: string };

const HEAD = sha("head commit");
const BASE = sha("base branch tip");
const MERGE_BASE = sha("common ancestor");
const HEAD_TREE = sha("head root tree");
const BEFORE_TREE = sha("before root tree");
const signal = new AbortController().signal;
const snapshot: GitHubSourceSnapshot = {
	reviewRunId: "catalog-review-run",
	baseRepositoryFullName: "takeat/api",
	headRepositoryFullName: "contributor/api",
	baseSha: BASE,
	headSha: HEAD,
	body: "Original PR description\r\n",
	diff: "Original complete diff\n",
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("GitHub source catalog", () => {
	it("reads head from the fork and before from the merge-base, with related paths confirmed against that tree", async () => {
		const git = new GitFixture(
			[
				{
					path: "src/main.ts",
					content: "import './contract.js';\nexport const version = 2;\n",
				},
				{ path: "src/contract.ts", content: "export type Contract = string;\n" },
				{ path: "src/unrelated.ts", content: "export const unrelated = true;\n" },
			],
			[{ path: "src/main.ts", content: "export const version = 1;\n" }],
		);
		const compare = new ComparisonFixture();
		const catalog = await createGitHubSourceCatalog(
			git,
			compare,
			snapshot,
			await artifactDirectory(),
			signal,
		);

		expect(await catalog.read(readRequest("head", "src/main.ts"), signal)).toMatchObject({
			kind: "loaded",
			content: "import './contract.js';\nexport const version = 2;\n",
			source: { role: "head", repositoryFullName: "contributor/api", revision: HEAD },
		});
		expect(await catalog.read(readRequest("before", "src/main.ts"), signal)).toMatchObject({
			kind: "loaded",
			content: "export const version = 1;\n",
			source: { role: "before", repositoryFullName: "takeat/api", revision: MERGE_BASE },
		});
		const related = await catalog.related(
			{ source: { role: "head", path: "src/main.ts" }, cursor: null, limit: 10 },
			signal,
		);
		if (related.kind !== "page") throw new Error("Expected related sources.");
		expect(related.entries.map((entry) => entry.path)).toEqual(["src/contract.ts"]);
		expect(compare.requests).toMatchObject([
			{ owner: "takeat", repo: "api", basehead: `${BASE}...contributor:${HEAD}` },
		]);
		expect(
			git.commitRequests.map(({ owner, repo, commit_sha }) => [owner, repo, commit_sha]),
		).toEqual([
			["contributor", "api", HEAD],
			["takeat", "api", MERGE_BASE],
		]);
	});

	it("walks nonrecursive subtree SHAs when the recursive tree is truncated and discovers more than 1,000 files", async () => {
		const git = new GitFixture();
		const sourceTree = sha("source subtree");
		const documentsTree = sha("codekeat subtree");
		const nestedTree = sha("nested docs subtree");
		const files = Array.from({ length: 1_001 }, (_, index) => ({
			path: `file-${index}.ts`,
			content: "export {};\n",
		}));
		const context = { path: "context.md", content: "\uFEFFComplete context\r\n💡\n" };
		git.treeResponses.set(
			treeKey("contributor", HEAD_TREE, "1"),
			tree(
				HEAD_TREE,
				[fileEntry({ path: "partial-only.ts", content: "Discard partial results" })],
				true,
			),
		);
		git.treeResponses.set(
			treeKey("contributor", HEAD_TREE),
			tree(HEAD_TREE, [directory("src", sourceTree), directory(".codekeat", documentsTree)]),
		);
		git.treeResponses.set(
			treeKey("contributor", sourceTree),
			tree(sourceTree, files.map(fileEntry)),
		);
		git.treeResponses.set(
			treeKey("contributor", documentsTree),
			tree(documentsTree, [directory("nested", nestedTree)]),
		);
		git.treeResponses.set(
			treeKey("contributor", nestedTree),
			tree(nestedTree, [fileEntry(context)]),
		);
		git.blobResponses.set(blobSha(context.content), blob(context.content));
		const catalog = await createGitHubSourceCatalog(
			git,
			new ComparisonFixture(),
			snapshot,
			await artifactDirectory(),
			signal,
		);

		const listed = await catalog.list(
			{ role: "head", prefix: "", cursor: null, limit: 2_000 },
			signal,
		);
		if (listed.kind !== "page") throw new Error("Expected the complete source tree.");
		expect(listed.totalEntries).toBe(1_002);
		expect(listed.nextCursor).toBeNull();
		expect(listed.entries.some((entry) => entry.path === "src/file-1000.ts")).toBe(true);
		expect(listed.entries.some((entry) => entry.path === ".codekeat/nested/context.md")).toBe(
			true,
		);
		expect(listed.entries.some((entry) => entry.path === "partial-only.ts")).toBe(false);
		expect(
			await catalog.read(readRequest("head", ".codekeat/nested/context.md"), signal),
		).toMatchObject({ kind: "loaded", content: context.content });
		expect(git.treeRequests).toHaveLength(5);
		for (const request of git.treeRequests.slice(1))
			expect(Object.hasOwn(request, "recursive")).toBe(false);
	});

	it("lists symlinks and submodules without fetching their targets or treating them as ordinary files", async () => {
		const git = new GitFixture([
			{ path: "target.txt", content: "Target exists in this repository" },
		]);
		git.treeResponses.set(
			treeKey("contributor", HEAD_TREE, "1"),
			tree(HEAD_TREE, [
				{
					path: "linked.txt",
					mode: "120000",
					type: "blob",
					sha: blobSha("target.txt"),
					size: 10,
				},
				{ path: "vendor", mode: "160000", type: "commit", sha: sha("submodule commit") },
				fileEntry({ path: "target.txt", content: "Target exists in this repository" }),
			]),
		);
		const catalog = await createGitHubSourceCatalog(
			git,
			new ComparisonFixture(),
			snapshot,
			await artifactDirectory(),
			signal,
		);
		const listed = await catalog.list(
			{ role: "head", prefix: "", cursor: null, limit: 10 },
			signal,
		);
		if (listed.kind !== "page") throw new Error("Expected repository entries.");

		expect(listed.entries.map(({ path, kind }) => ({ path, kind }))).toEqual([
			{ path: "linked.txt", kind: "symlink" },
			{ path: "target.txt", kind: "file" },
			{ path: "vendor", kind: "submodule" },
		]);
		for (const path of ["linked.txt", "vendor"])
			expect(await catalog.read(readRequest("head", path), signal)).toEqual({
				kind: "unavailable",
				reason: "unsupported_file",
				source: { role: "head", path },
			});
		expect(git.blobRequests).toEqual([]);
	});

	it.each([
		"mismatched commit SHA",
		"mismatched tree SHA",
		"mismatched blob SHA",
		"mismatched tree file size",
		"mismatched blob byte size",
		"nonrecursive tree with nested paths",
		"truncated nonrecursive tree",
	] as const)(
		"reports %s as an invalid response, without claiming the source is missing",
		async (failure) => {
			const file = { path: "src/file.ts", content: "Original bytes\n" };
			const git = new GitFixture([file]);
			applyInvalidResponse(git, file, failure);
			const catalog = await createGitHubSourceCatalog(
				git,
				new ComparisonFixture(),
				snapshot,
				await artifactDirectory(),
				signal,
			);

			expect(await catalog.read(readRequest("head", file.path), signal)).toEqual({
				kind: "unavailable",
				reason: "invalid_response",
				source: { role: "head", path: file.path },
			});
		},
	);

	it("shares overlapping blob reads and reopens their durable references without downloading blobs again", async () => {
		const content = "\uFEFFexport const original = '💡';\r\n";
		const git = new GitFixture([{ path: "src/file.ts", content }]);
		const directory = await artifactDirectory();
		const catalog = await createGitHubSourceCatalog(
			git,
			new ComparisonFixture(),
			snapshot,
			directory,
			signal,
		);
		const captured = await catalog.list(
			{ role: "pull_request", prefix: "", cursor: null, limit: 10 },
			signal,
		);
		if (captured.kind !== "page") throw new Error("Expected captured PR references.");
		const originalBody = captured.entries.find((entry) => entry.path === "body");
		if (originalBody === undefined) throw new Error("Expected the original PR body reference.");
		const ready = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		git.blobBarrier = { ready: ready.resolve, released: release.promise };
		const reads = Promise.all([
			catalog.read(readRequest("head", "src/file.ts"), signal),
			catalog.read(readRequest("head", "src/file.ts"), signal),
		]);
		await ready.promise;
		await setTimeout(10);
		release.resolve();
		const [first, second] = await reads;
		expect(first).toMatchObject({ kind: "loaded", content });
		expect(second).toEqual(first);
		expect(git.blobRequests).toHaveLength(1);
		if (first?.kind !== "loaded") throw new Error("Expected the persisted source reference.");

		const restoredGit = new GitFixture([{ path: "src/file.ts", content }]);
		const restored = await createGitHubSourceCatalog(
			restoredGit,
			new ComparisonFixture(),
			{ ...snapshot, body: "Edited description after restart\n" },
			directory,
			signal,
		);
		expect(
			await restored.read(
				{ ...readRequest("head", "src/file.ts"), source: first.source },
				signal,
			),
		).toEqual(first);
		expect(restoredGit.blobRequests).toEqual([]);
		expect(
			await restored.read(
				{ ...readRequest("head", "src/file.ts"), source: originalBody },
				signal,
			),
		).toMatchObject({
			kind: "loaded",
			source: {
				role: "pull_request",
				path: "body",
				contentHash: originalBody.contentHash,
			},
			content: snapshot.body,
		});
	});

	it("bounds each catalog to four active blob requests and sixteen across concurrent catalogs", async () => {
		const files = Array.from({ length: 8 }, (_, index) => ({
			path: `src/file-${index}.ts`,
			content: `export const value = ${index};\n`,
		}));
		const activity = new BlobActivity();
		const fixtures = Array.from({ length: 6 }, () => new GitFixture(files));
		const catalogs = await Promise.all(
			fixtures.map(async (git, index) => {
				git.blobWait = (request) => activity.wait(index, request.request.signal);
				return createGitHubSourceCatalog(
					git,
					new ComparisonFixture(),
					{ ...snapshot, reviewRunId: `bounded-run-${index}` },
					await artifactDirectory(),
					signal,
				);
			}),
		);
		const results = await Promise.all(
			catalogs.map((catalog) =>
				Promise.all(
					files.map((file) => catalog.read(readRequest("head", file.path), signal)),
				),
			),
		);
		expect(activity.peak).toBe(16);
		expect([...activity.peaks.values()]).toEqual(Array(6).fill(4));
		for (const sources of results)
			expect(sources.map((source) => source.kind === "loaded" && source.content)).toEqual(
				files.map((file) => file.content),
			);
	});

	it("does not reuse an authorized run's cached blobs in a different run with revoked access", async () => {
		const file = { path: "src/file.ts", content: "Authorized private source\n" };
		const directory = await artifactDirectory();
		const authorized = new GitFixture([file]);
		const first = await createGitHubSourceCatalog(
			authorized,
			new ComparisonFixture(),
			snapshot,
			directory,
			signal,
		);
		expect(await first.read(readRequest("head", file.path), signal)).toMatchObject({
			kind: "loaded",
			content: file.content,
		});
		const revoked = new GitFixture([file]);
		revoked.blobWait = async () => {
			throw Object.assign(new Error("Forbidden"), { status: 403 });
		};
		const second = await createGitHubSourceCatalog(
			revoked,
			new ComparisonFixture(),
			{ ...snapshot, reviewRunId: "another-authorized-run" },
			directory,
			signal,
		);
		expect(await second.read(readRequest("head", file.path), signal)).toEqual({
			kind: "unavailable",
			reason: "request_failed",
			source: { role: "head", path: file.path },
		});
		expect(revoked.blobRequests).toHaveLength(1);
	});

	it("aborts active blob I/O and never dispatches queued reads after cancellation", async () => {
		const files = Array.from({ length: 20 }, (_, index) => ({
			path: `src/file-${index}.ts`,
			content: `export const value = ${index};\n`,
		}));
		const git = new GitFixture(files);
		const controller = new AbortController();
		const ready = Promise.withResolvers<void>();
		const signals: AbortSignal[] = [];
		git.blobWait = async (request) => {
			signals.push(request.request.signal);
			if (signals.length === 4) ready.resolve();
			await setTimeout(10_000, undefined, { signal: request.request.signal });
		};
		const catalog = await createGitHubSourceCatalog(
			git,
			new ComparisonFixture(),
			snapshot,
			await artifactDirectory(),
			controller.signal,
		);
		const pending = Promise.allSettled(
			files.map((file) => catalog.read(readRequest("head", file.path), controller.signal)),
		);
		await ready.promise;
		controller.abort();
		expect((await pending).every((result) => result.status === "rejected")).toBe(true);
		expect(signals).toHaveLength(4);
		expect(signals.every((requestSignal) => requestSignal.aborted)).toBe(true);
	});

	it("keeps the before revision unavailable when the merge-base cannot be resolved", async () => {
		const git = new GitFixture([{ path: "src/file.ts", content: "Head remains available\n" }]);
		const compare: GitHubSourceComparisonApi = {
			async compareCommitsWithBasehead() {
				throw Object.assign(new Error("Forbidden"), { status: 403 });
			},
		};
		const catalog = await createGitHubSourceCatalog(
			git,
			compare,
			snapshot,
			await artifactDirectory(),
			signal,
		);

		expect(
			await catalog.list({ role: "before", prefix: "", cursor: null, limit: 10 }, signal),
		).toEqual({ kind: "unavailable", reason: "revision_unavailable" });
		expect(await catalog.read(readRequest("head", "src/file.ts"), signal)).toMatchObject({
			kind: "loaded",
			content: "Head remains available\n",
		});
		expect(git.commitRequests.map((request) => request.commit_sha)).toEqual([HEAD]);
	});
});

class GitFixture implements GitHubSourceGitApi {
	readonly commitRequests: CommitRequest[] = [];
	readonly treeRequests: TreeRequest[] = [];
	readonly blobRequests: BlobRequest[] = [];
	readonly commitResponses = new Map<string, unknown>();
	readonly treeResponses = new Map<string, unknown>();
	readonly blobResponses = new Map<string, unknown>();
	blobBarrier: { readonly ready: () => void; readonly released: Promise<void> } | null = null;
	blobWait: ((request: BlobRequest) => Promise<void>) | null = null;

	constructor(head: readonly SourceFile[] = [], before: readonly SourceFile[] = []) {
		this.commitResponses.set(HEAD, { sha: HEAD, tree: { sha: HEAD_TREE } });
		this.commitResponses.set(MERGE_BASE, {
			sha: MERGE_BASE,
			tree: { sha: BEFORE_TREE },
		});
		this.treeResponses.set(
			treeKey("contributor", HEAD_TREE, "1"),
			tree(HEAD_TREE, head.map(fileEntry)),
		);
		this.treeResponses.set(
			treeKey("takeat", BEFORE_TREE, "1"),
			tree(BEFORE_TREE, before.map(fileEntry)),
		);
		for (const file of [...head, ...before])
			this.blobResponses.set(blobSha(file.content), blob(file.content));
	}

	async getCommit(request: CommitRequest): Promise<{ readonly data: unknown }> {
		this.commitRequests.push(request);
		if (!this.commitResponses.has(request.commit_sha))
			throw new Error("Unexpected commit request");
		return { data: this.commitResponses.get(request.commit_sha) };
	}

	async getTree(request: TreeRequest): Promise<{ readonly data: unknown }> {
		this.treeRequests.push(request);
		const key = treeKey(request.owner, request.tree_sha, request.recursive);
		if (!this.treeResponses.has(key)) throw new Error("Unexpected tree request");
		return { data: this.treeResponses.get(key) };
	}

	async getBlob(request: BlobRequest): Promise<{ readonly data: unknown }> {
		this.blobRequests.push(request);
		await this.blobWait?.(request);
		if (this.blobBarrier !== null) {
			this.blobBarrier.ready();
			await this.blobBarrier.released;
		}
		if (!this.blobResponses.has(request.file_sha)) throw new Error("Unexpected blob request");
		return { data: this.blobResponses.get(request.file_sha) };
	}
}

class BlobActivity {
	readonly peaks = new Map<number, number>();
	private readonly activeByCatalog = new Map<number, number>();
	private active = 0;
	peak = 0;

	async wait(catalog: number, signal: AbortSignal): Promise<void> {
		this.active++;
		this.peak = Math.max(this.peak, this.active);
		const current = (this.activeByCatalog.get(catalog) ?? 0) + 1;
		this.activeByCatalog.set(catalog, current);
		this.peaks.set(catalog, Math.max(this.peaks.get(catalog) ?? 0, current));
		try {
			await setTimeout(10, undefined, { signal });
		} finally {
			this.active--;
			this.activeByCatalog.set(catalog, (this.activeByCatalog.get(catalog) ?? 1) - 1);
		}
	}
}

class ComparisonFixture implements GitHubSourceComparisonApi {
	readonly requests: CompareRequest[] = [];
	async compareCommitsWithBasehead(request: CompareRequest): Promise<{ readonly data: unknown }> {
		this.requests.push(request);
		return { data: { merge_base_commit: { sha: MERGE_BASE } } };
	}
}

function applyInvalidResponse(git: GitFixture, file: SourceFile, failure: string): void {
	switch (failure) {
		case "mismatched commit SHA":
			git.commitResponses.set(HEAD, { sha: BASE, tree: { sha: HEAD_TREE } });
			return;
		case "mismatched tree SHA":
			git.treeResponses.set(
				treeKey("contributor", HEAD_TREE, "1"),
				tree(BEFORE_TREE, [fileEntry(file)]),
			);
			return;
		case "mismatched blob SHA":
			git.blobResponses.set(blobSha(file.content), {
				...blob(file.content),
				sha: sha("another blob"),
			});
			return;
		case "mismatched tree file size":
			git.treeResponses.set(
				treeKey("contributor", HEAD_TREE, "1"),
				tree(HEAD_TREE, [
					{ ...fileEntry(file), size: Buffer.byteLength(file.content) + 1 },
				]),
			);
			return;
		case "mismatched blob byte size":
			git.blobResponses.set(blobSha(file.content), {
				...blob(file.content),
				size: Buffer.byteLength(file.content) + 1,
			});
			return;
		case "nonrecursive tree with nested paths":
			git.treeResponses.set(
				treeKey("contributor", HEAD_TREE, "1"),
				tree(HEAD_TREE, [], true),
			);
			git.treeResponses.set(
				treeKey("contributor", HEAD_TREE),
				tree(HEAD_TREE, [fileEntry(file)]),
			);
			return;
		case "truncated nonrecursive tree":
			git.treeResponses.set(
				treeKey("contributor", HEAD_TREE, "1"),
				tree(HEAD_TREE, [], true),
			);
			git.treeResponses.set(treeKey("contributor", HEAD_TREE), tree(HEAD_TREE, [], true));
	}
}

async function artifactDirectory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "codekeat-github-catalog-"));
	temporaryDirectories.push(path);
	return path;
}

function readRequest(
	role: "head" | "before",
	path: string,
): {
	readonly source: { readonly role: "head" | "before"; readonly path: string };
	readonly range: {
		readonly kind: "lines";
		readonly startLine: number;
		readonly lineCount: number;
	};
} {
	return {
		source: { role, path },
		range: { kind: "lines", startLine: 1, lineCount: Number.MAX_SAFE_INTEGER },
	};
}

function treeKey(owner: string, treeSha: string, recursive?: "1"): string {
	return `${owner}/${treeSha}/${recursive ?? "direct"}`;
}

function tree(
	treeSha: string,
	entries: readonly TreeEntry[],
	truncated = false,
): {
	readonly sha: string;
	readonly tree: readonly TreeEntry[];
	readonly truncated: boolean;
} {
	return { sha: treeSha, tree: entries, truncated };
}

function directory(path: string, treeSha: string): TreeEntry {
	return { path, mode: "040000", type: "tree", sha: treeSha };
}

function fileEntry(file: SourceFile): TreeEntry {
	return {
		path: file.path,
		mode: "100644",
		type: "blob",
		sha: blobSha(file.content),
		size: Buffer.byteLength(file.content),
	};
}

function blob(content: string): {
	readonly sha: string;
	readonly encoding: "base64";
	readonly content: string;
	readonly size: number;
} {
	return {
		sha: blobSha(content),
		encoding: "base64",
		content: Buffer.from(content).toString("base64"),
		size: Buffer.byteLength(content),
	};
}

function blobSha(content: string): string {
	return createHash("sha1")
		.update(`blob ${Buffer.byteLength(content)}\0`)
		.update(content)
		.digest("hex");
}

function sha(value: string): string {
	return createHash("sha1").update(value).digest("hex");
}
