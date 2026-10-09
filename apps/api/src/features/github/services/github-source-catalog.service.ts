import { createHash } from "node:crypto";
import { posix } from "node:path";
import { Cache, Duration, Effect, Exit, Semaphore } from "effect";
import { z } from "zod";

import {
	isRepositoryPath,
	ReviewSourceArtifactService,
	ReviewSourceCatalogService,
	type ReviewSourceBackend,
	type ReviewSourceDocument,
	type ReviewSourceEntry,
	type ReviewSourceIdentity,
	type ReviewSourceReference,
	type ReviewSourceRevision,
	type ReviewSourceRole,
	type ReviewSourceUnavailable,
	type ReviewMetricRecorder,
} from "#features/review";
import {
	githubContextRequests,
	observeGitHubContextRequest,
} from "../utils/github-context-request.util.js";

const SHA = z.string().regex(/^[a-f0-9]{40}$/);
const COMMIT = z.object({ sha: SHA, tree: z.object({ sha: SHA }) });
const TREE_ENTRY = z.object({
	path: z.string(),
	mode: z.enum(["100644", "100755", "040000", "120000", "160000"]),
	type: z.enum(["blob", "tree", "commit"]),
	sha: SHA,
	size: z.number().int().nonnegative().optional(),
});
const TREE = z.object({ sha: SHA, truncated: z.boolean(), tree: z.array(TREE_ENTRY) });
const BLOB = z.object({
	sha: SHA,
	encoding: z.literal("base64"),
	content: z.string(),
	size: z.number().int().nonnegative(),
});
const COMPARISON = z.object({ merge_base_commit: z.object({ sha: SHA }) });
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONCURRENCY = 4;
type Tree = z.infer<typeof TREE>;
type TreeEntry = z.infer<typeof TREE_ENTRY>;
type RepositoryRole = "head" | "before";
type Missing = { readonly kind: "missing"; readonly source: ReviewSourceIdentity };
type Location = {
	readonly owner: string;
	readonly repo: string;
	readonly request: { readonly signal: AbortSignal };
};
export interface GitHubSourceGitApi {
	getCommit(
		location: Location & { readonly commit_sha: string },
	): Promise<{ readonly data: unknown }>;
	getTree(
		location: Location & { readonly tree_sha: string; readonly recursive?: "1" },
	): Promise<{ readonly data: unknown }>;
	getBlob(
		location: Location & { readonly file_sha: string },
	): Promise<{ readonly data: unknown }>;
}
export interface GitHubSourceComparisonApi {
	compareCommitsWithBasehead(
		location: Location & { readonly basehead: string },
	): Promise<{ readonly data: unknown }>;
}
export interface GitHubSourceSnapshot {
	readonly reviewRunId: string;
	readonly baseRepositoryFullName: string;
	readonly headRepositoryFullName: string | null;
	readonly baseSha: string;
	readonly headSha: string;
	readonly body: string | null;
	readonly diff: string;
}
interface Target {
	readonly role: RepositoryRole;
	readonly repositoryFullName: string;
	readonly revision: string;
}
interface CatalogFile {
	readonly entry: ReviewSourceEntry;
	readonly blobSha: string;
}
interface SnapshotTree {
	readonly files: ReadonlyMap<string, CatalogFile>;
	readonly entries: readonly ReviewSourceEntry[];
}
interface TreeJob {
	readonly prefix: string;
	readonly sha: string;
	readonly ancestors: ReadonlySet<string>;
}

export async function createGitHubSourceCatalog(
	git: GitHubSourceGitApi,
	comparison: GitHubSourceComparisonApi,
	snapshot: GitHubSourceSnapshot,
	artifactDirectory: string,
	signal: AbortSignal,
	recordMetric: ReviewMetricRecorder = () => undefined,
): Promise<ReviewSourceCatalogService> {
	const before = await resolveMergeBase(comparison, snapshot, signal, recordMetric);
	const artifacts = new ReviewSourceArtifactService(artifactDirectory, snapshot.reviewRunId);
	const targets = repositoryTargets(snapshot, before);
	const revisions: ReviewSourceRevision[] = [
		{
			role: "head",
			repositoryFullName: snapshot.headRepositoryFullName,
			revision: snapshot.headSha,
		},
		...targets.filter((target) => target.role === "before"),
		{
			role: "pull_request",
			repositoryFullName: snapshot.baseRepositoryFullName,
			revision: snapshot.headSha,
		},
		{ role: "investigation", repositoryFullName: null, revision: "unconfirmed" },
	];
	const backend = new GitHubSourceBackend(git, targets, artifacts, recordMetric);
	const documents = [
		capturedDocument("body", snapshot.body ?? "", snapshot),
		capturedDocument("diff", snapshot.diff, snapshot),
	];
	await Effect.runPromise(
		Effect.forEach(
			documents,
			(document) =>
				artifactRequest((requestSignal) => artifacts.write(document, requestSignal)),
			{ concurrency: CONCURRENCY },
		),
		{ signal },
	);
	return new ReviewSourceCatalogService(revisions, backend, artifacts, documents);
}

class GitHubSourceBackend implements ReviewSourceBackend {
	private readonly requests = Semaphore.makeUnsafe(CONCURRENCY);
	private readonly targets: ReadonlyMap<RepositoryRole, Target>;
	private readonly snapshots: Cache.Cache<RepositoryRole, SnapshotTree, ReviewSourceUnavailable>;
	private readonly trees: Cache.Cache<string, Tree, ReviewSourceUnavailable>;
	private readonly files: Cache.Cache<
		string,
		ReviewSourceReference,
		ReviewSourceUnavailable | Missing
	>;
	constructor(
		private readonly git: GitHubSourceGitApi,
		targets: readonly Target[],
		private readonly artifacts: ReviewSourceArtifactService,
		private readonly recordMetric: ReviewMetricRecorder,
	) {
		this.targets = new Map(targets.map((target) => [target.role, target]));
		// Caches are owned by one authorized run; completed file lookups retain only disk references.
		this.snapshots = Effect.runSync(
			Cache.makeWith((role: RepositoryRole) => this.snapshot(role), {
				capacity: Number.MAX_SAFE_INTEGER,
				timeToLive: successfulSourceLifetime,
			}),
		);
		this.trees = Effect.runSync(
			Cache.makeWith((key: string) => this.tree(key), {
				capacity: Number.MAX_SAFE_INTEGER,
				timeToLive: successfulSourceLifetime,
			}),
		);
		this.files = Effect.runSync(
			Cache.makeWith((key: string) => this.file(key), {
				capacity: Number.MAX_SAFE_INTEGER,
				timeToLive: successfulSourceLifetime,
			}),
		);
	}
	entries(
		role: ReviewSourceRole,
	): Effect.Effect<readonly ReviewSourceEntry[], ReviewSourceUnavailable> {
		if (!repositoryRole(role)) return Effect.fail(unavailable("invalid_request"));
		return Cache.get(this.snapshots, role).pipe(Effect.map((snapshot) => snapshot.entries));
	}
	document(
		source: ReviewSourceIdentity,
	): Effect.Effect<ReviewSourceDocument, ReviewSourceUnavailable | Missing> {
		if (!repositoryRole(source.role) || !isRepositoryPath(source.path))
			return Effect.fail(unavailable("invalid_request"));
		return Effect.gen({ self: this }, function* () {
			const reference = yield* Cache.get(
				this.files,
				JSON.stringify([source.role, source.path]),
			);
			if (source.contentHash != null && source.contentHash !== reference.contentHash)
				return yield* Effect.fail(unavailable("invalid_request"));
			const document = yield* artifactRequest((signal) =>
				this.artifacts.read(reference, signal),
			);
			if (document === null) return yield* Effect.fail(unavailable("invalid_response"));
			return document;
		});
	}
	private snapshot(role: RepositoryRole): Effect.Effect<SnapshotTree, ReviewSourceUnavailable> {
		const target = this.targets.get(role);
		if (target === undefined)
			return Effect.fail(
				unavailable(role === "head" ? "repository_unavailable" : "revision_unavailable"),
			);
		return Effect.gen({ self: this }, function* () {
			const commit = yield* this.request(
				(signal) =>
					this.git.getCommit({
						...location(target, signal),
						commit_sha: target.revision,
					}),
				COMMIT,
			);
			if (commit.sha !== target.revision)
				return yield* Effect.fail(unavailable("invalid_response"));
			const root = commit.tree.sha;
			const recursive = yield* this.readTree(target, root, true);
			const entries = recursive.truncated
				? yield* this.walkTree(target, root)
				: recursive.tree;
			return yield* Effect.try({
				try: () => snapshotTree(target, entries),
				catch: () => unavailable("invalid_response"),
			});
		});
	}
	private walkTree(
		target: Target,
		root: string,
	): Effect.Effect<readonly TreeEntry[], ReviewSourceUnavailable> {
		return Effect.gen({ self: this }, function* () {
			const entries: TreeEntry[] = [];
			let pending: readonly TreeJob[] = [
				{ prefix: "", sha: root, ancestors: new Set([root]) },
			];
			while (pending.length > 0) {
				const groups = yield* Effect.forEach(
					pending,
					(job) => this.treeChildren(target, job),
					{ concurrency: CONCURRENCY },
				);
				entries.push(...groups.flatMap((group) => group.entries));
				pending = groups.flatMap((group) => group.jobs);
			}
			return entries;
		});
	}
	private treeChildren(
		target: Target,
		job: TreeJob,
	): Effect.Effect<
		{ readonly entries: readonly TreeEntry[]; readonly jobs: readonly TreeJob[] },
		ReviewSourceUnavailable
	> {
		return this.readTree(target, job.sha, false).pipe(
			Effect.flatMap((tree) => {
				if (tree.truncated || tree.tree.some((entry) => !validDirectEntry(entry)))
					return Effect.fail(unavailable("invalid_response"));
				return Effect.try({
					try: () => expandChildren(tree.tree, job),
					catch: () => unavailable("invalid_response"),
				});
			}),
		);
	}
	private readTree(
		target: Target,
		sha: string,
		recursive: boolean,
	): Effect.Effect<Tree, ReviewSourceUnavailable> {
		return Cache.get(this.trees, JSON.stringify([target.role, sha, recursive]));
	}
	private tree(key: string): Effect.Effect<Tree, ReviewSourceUnavailable> {
		const [role, sha, recursive] = z
			.tuple([z.enum(["head", "before"]), SHA, z.boolean()])
			.parse(JSON.parse(key));
		const target = this.targets.get(role)!;
		return this.request(
			(signal) =>
				this.git.getTree({
					...location(target, signal),
					tree_sha: sha,
					...(recursive ? { recursive: "1" as const } : {}),
				}),
			TREE,
		).pipe(
			Effect.flatMap((tree) =>
				tree.sha === sha
					? Effect.succeed(tree)
					: Effect.fail(unavailable("invalid_response")),
			),
		);
	}
	private file(
		key: string,
	): Effect.Effect<ReviewSourceReference, ReviewSourceUnavailable | Missing> {
		const [role, path] = z
			.tuple([z.enum(["head", "before"]), z.string()])
			.parse(JSON.parse(key));
		return Effect.gen({ self: this }, function* () {
			const snapshot = yield* Cache.get(this.snapshots, role);
			const file = snapshot.files.get(path);
			if (file === undefined)
				return yield* Effect.fail({ kind: "missing" as const, source: { role, path } });
			if (file.entry.kind !== "file")
				return yield* Effect.fail(unavailable("unsupported_file"));
			const existing = yield* artifactRequest((signal) =>
				this.artifacts.read({ role, path }, signal),
			);
			if (existing !== null && sameRevision(existing.source, file.entry))
				return existing.source;
			const target = this.targets.get(role)!;
			const blob = yield* this.request(
				(signal) =>
					this.git.getBlob({ ...location(target, signal), file_sha: file.blobSha }),
				BLOB,
			);
			const document = yield* Effect.try({
				try: () => decodeBlob(blob, file),
				catch: () => unavailable("invalid_response"),
			});
			return yield* artifactRequest((signal) => this.artifacts.write(document, signal));
		});
	}
	private request<A>(
		call: (signal: AbortSignal) => Promise<{ readonly data: unknown }>,
		schema: z.ZodType<A>,
	): Effect.Effect<A, ReviewSourceUnavailable> {
		return this.requests.withPermit(
			githubContextRequests.withPermit(
				observeGitHubContextRequest(
					Effect.tryPromise({
						try: async (signal) => {
							const response = await call(signal);
							return schema.parse(response.data);
						},
						catch: (error) =>
							unavailable(
								error instanceof z.ZodError ? "invalid_response" : "request_failed",
							),
					}),
					this.recordMetric,
				),
			),
		);
	}
}

/** A frozen snapshot stays reusable; a failed lookup must permit a fresh attempt in this run. */
function successfulSourceLifetime<A, E>(exit: Exit.Exit<A, E>): Duration.Duration {
	return Exit.isSuccess(exit) ? Duration.infinity : Duration.zero;
}

function snapshotTree(target: Target, entries: readonly TreeEntry[]): SnapshotTree {
	const files = new Map<string, CatalogFile>();
	for (const entry of entries) {
		validateTreeEntry(entry);
		if (entry.type === "tree") continue;
		if (files.has(entry.path)) throw new Error("Duplicate Git tree path.");
		files.set(entry.path, {
			entry: {
				...target,
				path: entry.path,
				kind: sourceKind(entry),
				contentHash: null,
				sizeBytes: entry.size ?? null,
			},
			blobSha: entry.sha,
		});
	}
	return {
		files,
		entries: [...files.values()]
			.map((file) => file.entry)
			.sort((a, b) => a.path.localeCompare(b.path, "en")),
	};
}
function validateTreeEntry(entry: TreeEntry): void {
	if (!isRepositoryPath(entry.path) || !validEntryMode(entry))
		throw new Error("Invalid Git tree entry.");
}
function expandChildren(
	entries: readonly TreeEntry[],
	parent: TreeJob,
): { readonly entries: readonly TreeEntry[]; readonly jobs: readonly TreeJob[] } {
	const files: TreeEntry[] = [];
	const jobs: TreeJob[] = [];
	for (const entry of entries) {
		const path = parent.prefix === "" ? entry.path : posix.join(parent.prefix, entry.path);
		if (entry.type !== "tree") {
			files.push({ ...entry, path });
			continue;
		}
		if (parent.ancestors.has(entry.sha)) throw new Error("Cyclic Git tree.");
		jobs.push({
			prefix: path,
			sha: entry.sha,
			ancestors: new Set([...parent.ancestors, entry.sha]),
		});
	}
	return { entries: files, jobs };
}
function validEntryMode(entry: TreeEntry): boolean {
	if (entry.type === "tree") return entry.mode === "040000";
	if (entry.type === "commit") return entry.mode === "160000";
	return entry.mode === "100644" || entry.mode === "100755" || entry.mode === "120000";
}
function sourceKind(entry: TreeEntry): ReviewSourceEntry["kind"] {
	if (entry.mode === "160000") return "submodule";
	return entry.mode === "120000" ? "symlink" : "file";
}
function decodeBlob(blob: z.infer<typeof BLOB>, file: CatalogFile): ReviewSourceDocument {
	const canonical = blob.content.replace(/[\r\n]/g, "");
	if (!BASE64.test(canonical)) throw new Error("Invalid Git blob encoding.");
	const bytes = Buffer.from(canonical, "base64");
	validateBlob(bytes, canonical, blob, file);
	return {
		source: {
			...file.entry,
			contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
		},
		content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
	};
}
function validateBlob(
	bytes: Buffer,
	canonical: string,
	blob: z.infer<typeof BLOB>,
	file: CatalogFile,
): void {
	validateBlobEncoding(bytes, canonical, blob, file.blobSha);
	if (file.entry.sizeBytes !== null && bytes.length !== file.entry.sizeBytes)
		throw new Error("Invalid Git blob size.");
	const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
	if (sha !== file.blobSha) throw new Error("Invalid Git blob identity.");
}
function validateBlobEncoding(
	bytes: Buffer,
	canonical: string,
	blob: z.infer<typeof BLOB>,
	sha: string,
): void {
	if (blob.sha !== sha || bytes.length !== blob.size || bytes.toString("base64") !== canonical)
		throw new Error("Invalid Git blob content.");
}
function sameRevision(source: ReviewSourceReference, expected: ReviewSourceReference): boolean {
	return (
		source.repositoryFullName === expected.repositoryFullName &&
		source.revision === expected.revision
	);
}
function validDirectChild(path: string): boolean {
	return isRepositoryPath(path) && !path.includes("/");
}
function validDirectEntry(entry: TreeEntry): boolean {
	return validDirectChild(entry.path) && validEntryMode(entry);
}
function repositoryRole(role: ReviewSourceRole): role is RepositoryRole {
	return role === "head" || role === "before";
}
function location(target: Pick<Target, "repositoryFullName">, signal: AbortSignal): Location {
	const [owner, repo] = target.repositoryFullName.split("/");
	if (owner === undefined || repo === undefined) throw new Error("Invalid repository identity.");
	return { owner, repo, request: { signal } };
}
function unavailable(reason: ReviewSourceUnavailable["reason"]): ReviewSourceUnavailable {
	return { kind: "unavailable", reason };
}
function artifactRequest<A>(
	call: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, ReviewSourceUnavailable> {
	return Effect.tryPromise({ try: call, catch: () => unavailable("invalid_response") });
}
function repositoryTargets(
	snapshot: GitHubSourceSnapshot,
	before: string | null,
): readonly Target[] {
	const targets: Target[] = [];
	if (snapshot.headRepositoryFullName !== null)
		targets.push({
			role: "head",
			repositoryFullName: snapshot.headRepositoryFullName,
			revision: snapshot.headSha,
		});
	if (before !== null)
		targets.push({
			role: "before",
			repositoryFullName: snapshot.baseRepositoryFullName,
			revision: before,
		});
	return targets;
}
function capturedDocument(
	path: string,
	content: string,
	snapshot: GitHubSourceSnapshot,
): ReviewSourceDocument {
	return {
		source: {
			role: "pull_request",
			path,
			repositoryFullName: snapshot.baseRepositoryFullName,
			revision: snapshot.headSha,
			contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
		},
		content,
	};
}
async function resolveMergeBase(
	api: GitHubSourceComparisonApi,
	snapshot: GitHubSourceSnapshot,
	signal: AbortSignal,
	recordMetric: ReviewMetricRecorder,
): Promise<string | null> {
	if (snapshot.headRepositoryFullName === null) return null;
	const headOwner = snapshot.headRepositoryFullName.split("/")[0]!;
	const basehead = `${snapshot.baseSha}...${headOwner}:${snapshot.headSha}`;
	const request = githubContextRequests
		.withPermit(
			observeGitHubContextRequest(
				Effect.tryPromise({
					try: async (requestSignal) => {
						const response = await api.compareCommitsWithBasehead({
							...location(
								{ repositoryFullName: snapshot.baseRepositoryFullName },
								requestSignal,
							),
							basehead,
						});
						return COMPARISON.parse(response.data).merge_base_commit.sha;
					},
					catch: () => unavailable("revision_unavailable"),
				}),
				recordMetric,
			),
		)
		.pipe(Effect.catch(() => Effect.succeed(null)));
	return Effect.runPromise(request, { signal });
}
