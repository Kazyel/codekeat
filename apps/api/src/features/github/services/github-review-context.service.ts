import { Buffer } from "node:buffer";
import { posix } from "node:path";
import { Cache, Effect, Semaphore } from "effect";
import { z } from "zod";

import {
	isRepositoryPath,
	reviewSupportingPathCandidates,
	type ReviewContextFile,
	type ReviewInputChunk,
	type ReviewRepositoryContext,
} from "#features/review";

const CONTEXT_DOCUMENT_PATHS = [
	".codekeat/README.md",
	".codekeat/domain.md",
	".codekeat/integrations.md",
];
const FILE_CONTENT_SCHEMA = z.object({
	type: z.literal("file"),
	encoding: z.enum(["base64", "none"]),
	content: z.string(),
	size: z.number().int().nonnegative(),
	target: z.never().optional(),
	submodule_git_url: z.never().optional(),
});
const DIRECTORY_SCHEMA = z.array(
	z.object({
		name: z.string(),
		path: z.string(),
		type: z.enum(["file", "dir", "symlink", "submodule"]),
	}),
);
type DirectoryEntry = z.infer<typeof DIRECTORY_SCHEMA>[number];
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TEXT_CONTROL_BYTES = new Set([9, 10, 13]);
const CONTEXT_REQUEST_CONCURRENCY = 4;
// Slots carry no repository data or credentials; authorization-dependent caches stay per invocation.
const GLOBAL_CONTEXT_REQUESTS = Semaphore.makeUnsafe(16);
type ContextRequestFailure = Exclude<ReviewContextFile, { readonly kind: "loaded" }>;
interface DirectoryContext {
	readonly entries: readonly DirectoryEntry[];
	readonly failure: ContextRequestFailure | null;
}
interface DocumentationContext {
	readonly paths: readonly string[];
	readonly failures: readonly ContextRequestFailure[];
}

export type GitHubReviewContentLocation = {
	readonly owner: string;
	readonly repo: string;
	readonly path: string;
	readonly ref: string;
	readonly headers?: { readonly accept: string };
	readonly request?: { readonly signal: AbortSignal };
};

export interface GitHubReviewContentSource {
	getContent(location: GitHubReviewContentLocation): Promise<{ readonly data: unknown }>;
}

export async function loadGitHubReviewContext(
	source: GitHubReviewContentSource,
	repositoryFullName: string | null,
	revision: string,
	chunks: readonly ReviewInputChunk[],
	signal: AbortSignal = new AbortController().signal,
): Promise<ReviewRepositoryContext> {
	return Effect.runPromise(
		new GitHubReviewContextLoader(source, repositoryFullName, revision, signal).load(chunks),
		{ signal },
	);
}

class GitHubReviewContextLoader {
	private readonly files: Cache.Cache<string, ReviewContextFile>;
	private readonly directories: Cache.Cache<string, DirectoryContext>;
	private readonly requests = Semaphore.makeUnsafe(CONTEXT_REQUEST_CONCURRENCY);

	constructor(
		private readonly source: GitHubReviewContentSource,
		private readonly repositoryFullName: string | null,
		private readonly revision: string,
		private readonly signal: AbortSignal,
	) {
		// One invocation owns both caches. No eviction or TTL can repeat a lookup mid-review.
		this.files = Effect.runSync(
			Cache.make({
				capacity: Number.MAX_SAFE_INTEGER,
				lookup: (path: string) => this.requestFile(path),
			}),
		);
		this.directories = Effect.runSync(
			Cache.make({
				capacity: Number.MAX_SAFE_INTEGER,
				lookup: (path: string) => this.requestDirectory(path),
			}),
		);
	}

	load(chunks: readonly ReviewInputChunk[]): Effect.Effect<ReviewRepositoryContext> {
		return Effect.gen({ self: this }, function* () {
			const changedPaths = [
				...new Set(chunks.flatMap((chunk) => [...chunk.changedLines.keys()])),
			];
			const documentation = yield* this.documentationPaths();
			const paths = new Set([...documentation.paths, ...changedPaths]);
			const files = yield* Effect.forEach(paths, (path) => Cache.get(this.files, path), {
				concurrency: CONTEXT_REQUEST_CONCURRENCY,
			});
			const filesByPath = new Map(files.map((file) => [file.path, file]));
			const supporting = yield* Effect.forEach(
				changedPaths,
				(path) => this.loadSupportingFiles(filesByPath.get(path)!, paths),
				{ concurrency: CONTEXT_REQUEST_CONCURRENCY },
			);
			return {
				repositoryFullName: this.repositoryFullName,
				revision: this.revision,
				files: [
					...new Map(
						[...documentation.failures, ...files, ...supporting.flat()].map((file) => [
							file.path,
							file,
						]),
					).values(),
				],
				omittedFileCount: 0,
			};
		});
	}

	private documentationPaths(): Effect.Effect<DocumentationContext> {
		return Effect.gen({ self: this }, function* () {
			const paths = new Set(CONTEXT_DOCUMENT_PATHS);
			const failures: ContextRequestFailure[] = [];
			let pending = [".codekeat"];
			const visited = new Set<string>();
			while (pending.length > 0) {
				const directories = [...new Set(pending)].filter((path) => !visited.has(path));
				directories.forEach((path) => visited.add(path));
				const groups = yield* Effect.forEach(
					directories,
					(path) => Cache.get(this.directories, path),
					{
						concurrency: CONTEXT_REQUEST_CONCURRENCY,
					},
				);
				for (const group of groups) {
					if (group.failure !== null) failures.push(group.failure);
					for (const entry of group.entries.filter((entry) => entry.type === "file"))
						paths.add(entry.path);
				}
				pending = groups.flatMap((group) =>
					group.entries
						.filter((entry) => entry.type === "dir")
						.map((entry) => entry.path),
				);
			}
			return { paths: [...paths], failures };
		});
	}

	private loadSupportingFiles(
		file: ReviewContextFile,
		loadedPaths: ReadonlySet<string>,
	): Effect.Effect<readonly ReviewContextFile[]> {
		if (file.kind !== "loaded") return Effect.succeed([]);
		const candidates = reviewSupportingPathCandidates(file.path, file.content).filter(
			(candidate) => !loadedPaths.has(candidate),
		);
		return Effect.forEach(candidates, (path) => this.supportingFile(path), {
			concurrency: CONTEXT_REQUEST_CONCURRENCY,
		}).pipe(Effect.map((groups) => groups.flat()));
	}

	private supportingFile(path: string): Effect.Effect<readonly ReviewContextFile[]> {
		return Cache.get(this.directories, posix.dirname(path)).pipe(
			Effect.flatMap((directory) => {
				if (directory.failure !== null) return Effect.succeed([directory.failure]);
				if (
					!directory.entries.some((entry) => entry.type === "file" && entry.path === path)
				)
					return Effect.succeed([]);
				return Cache.get(this.files, path).pipe(Effect.map((file) => [file]));
			}),
		);
	}

	private requestDirectory(path: string): Effect.Effect<DirectoryContext> {
		const location = this.location(path);
		if (location === null) return Effect.succeed({ entries: [], failure: null });
		return this.request(location).pipe(
			Effect.map((data) => directoryContext(path, data)),
			Effect.catch((failure) =>
				Effect.succeed({
					entries: [],
					failure: failure.kind === "missing" ? null : failure,
				}),
			),
		);
	}

	private requestFile(path: string): Effect.Effect<ReviewContextFile> {
		const location = this.location(path);
		if (location === null)
			return Effect.succeed({
				kind: "unavailable",
				path,
				reason: "head_repository_unavailable",
			});
		return this.request(location).pipe(
			Effect.flatMap((data) => this.parseFileData(data, location)),
			Effect.catch((failure) => Effect.succeed(failure)),
		);
	}

	private parseFileData(
		data: z.JSONType,
		location: GitHubReviewContentLocation,
	): Effect.Effect<ReviewContextFile, ContextRequestFailure> {
		const parsed = FILE_CONTENT_SCHEMA.safeParse(data);
		if (!parsed.success) return Effect.succeed(invalidContextFile(location.path));
		const content =
			parsed.data.encoding === "none"
				? this.readRawFile(location, parsed.data.size)
				: Effect.succeed(decodeTextContent(parsed.data.content, parsed.data.size));
		return content.pipe(Effect.map((value) => loadedContextFile(location.path, value)));
	}

	private readRawFile(
		location: GitHubReviewContentLocation,
		size: number,
	): Effect.Effect<string | null, ContextRequestFailure> {
		return this.request({
			...location,
			headers: { accept: "application/vnd.github.raw+json" },
		}).pipe(
			Effect.map((data) => {
				const content = z.string().safeParse(data);
				if (!content.success) return null;
				return validRawText(content.data, size) ? content.data : null;
			}),
		);
	}

	private request(
		location: GitHubReviewContentLocation,
	): Effect.Effect<z.JSONType, ContextRequestFailure> {
		// Every actual HTTP request, including raw media and directory reads, shares four permits.
		return this.requests.withPermit(
			GLOBAL_CONTEXT_REQUESTS.withPermit(
				Effect.tryPromise({
					try: async (signal) => {
						this.signal.throwIfAborted();
						const response = await this.source.getContent({
							...location,
							request: { signal: AbortSignal.any([signal, this.signal]) },
						});
						return response.data;
					},
					catch: (error) => contextRequestFailure(error, location.path),
				}).pipe(
					Effect.flatMap((data) => {
						const parsed = z.json().safeParse(data);
						return parsed.success
							? Effect.succeed(parsed.data)
							: Effect.fail(invalidContextFile(location.path));
					}),
				),
			),
		);
	}

	private location(path: string): GitHubReviewContentLocation | null {
		if (this.repositoryFullName === null) return null;
		const [owner, repo] = this.repositoryFullName.split("/");
		if (owner === undefined || repo === undefined) return null;
		return {
			owner,
			repo,
			path: path === "." ? "" : path,
			ref: this.revision,
			request: { signal: this.signal },
		};
	}
}

function validDirectoryChild(directory: string, entry: DirectoryEntry): boolean {
	return (
		isRepositoryPath(entry.path) &&
		posix.dirname(entry.path) === directory &&
		posix.basename(entry.path) === entry.name
	);
}

function directoryContext(path: string, data: z.JSONType): DirectoryContext {
	const parsed = DIRECTORY_SCHEMA.safeParse(data);
	if (!parsed.success) return { entries: [], failure: invalidContextFile(path) };
	return {
		entries: parsed.data.filter((entry) => validDirectoryChild(path, entry)),
		failure: null,
	};
}

function loadedContextFile(path: string, content: string | null): ReviewContextFile {
	return content === null ? invalidContextFile(path) : { kind: "loaded", path, content };
}

function invalidContextFile(path: string): ContextRequestFailure {
	return { kind: "unavailable", path, reason: "invalid_response" };
}

function contextRequestFailure(error: unknown, path: string): ContextRequestFailure {
	if (typeof error === "object" && error !== null && "status" in error && error.status === 404)
		return { kind: "missing", path };
	return { kind: "unavailable", path, reason: "request_failed" };
}

function decodeTextContent(encoded: string, size: number): string | null {
	const canonical = encoded.replace(/[\r\n]/g, "");
	if (!BASE64_PATTERN.test(canonical)) return null;
	const bytes = Buffer.from(canonical, "base64");
	if (!validEncodedText(bytes, size, canonical)) return null;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

function validEncodedText(bytes: Buffer, size: number, canonical: string): boolean {
	return bytes.length === size && bytes.toString("base64") === canonical && !binaryBytes(bytes);
}

function validRawText(content: string, size: number): boolean {
	const bytes = Buffer.from(content, "utf8");
	return bytes.length === size && !binaryBytes(bytes);
}

function binaryBytes(bytes: Buffer): boolean {
	return bytes.some((byte) => (byte < 32 && !TEXT_CONTROL_BYTES.has(byte)) || byte === 127);
}
