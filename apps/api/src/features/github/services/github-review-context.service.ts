import { Buffer } from "node:buffer";
import { posix } from "node:path";
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
	return new GitHubReviewContextLoader(source, repositoryFullName, revision, signal).load(chunks);
}

class GitHubReviewContextLoader {
	private readonly files = new Map<string, ReviewContextFile>();
	private readonly directories = new Map<string, readonly DirectoryEntry[]>();

	constructor(
		private readonly source: GitHubReviewContentSource,
		private readonly repositoryFullName: string | null,
		private readonly revision: string,
		private readonly signal: AbortSignal,
	) {}

	async load(chunks: readonly ReviewInputChunk[]): Promise<ReviewRepositoryContext> {
		const changedPaths = [
			...new Set(chunks.flatMap((chunk) => [...chunk.changedLines.keys()])),
		];
		const documentation = await this.documentationPaths();
		for (const path of [...documentation, ...changedPaths]) await this.loadFile(path);
		for (const path of changedPaths) await this.loadSupportingFiles(path);
		return {
			repositoryFullName: this.repositoryFullName,
			revision: this.revision,
			files: [...this.files.values()],
			omittedFileCount: 0,
		};
	}

	private async documentationPaths(): Promise<readonly string[]> {
		const paths = new Set(CONTEXT_DOCUMENT_PATHS);
		const pending = [".codekeat"];
		const visited = new Set<string>();
		for (let cursor = 0; cursor < pending.length; cursor++) {
			const directory = pending[cursor]!;
			if (visited.has(directory)) continue;
			visited.add(directory);
			const entries = await this.listDirectory(directory);
			pending.push(
				...entries.filter((entry) => entry.type === "dir").map((entry) => entry.path),
			);
			for (const entry of entries.filter((entry) => entry.type === "file"))
				paths.add(entry.path);
		}
		return [...paths];
	}

	private async loadSupportingFiles(path: string): Promise<void> {
		const file = this.files.get(path);
		if (file?.kind !== "loaded") return;
		const candidates = reviewSupportingPathCandidates(path, file.content).filter(
			(candidate) => !this.files.has(candidate),
		);
		for (const candidate of candidates) {
			const entries = await this.listDirectory(posix.dirname(candidate));
			if (entries.some((entry) => entry.type === "file" && entry.path === candidate))
				await this.loadFile(candidate);
		}
	}

	private async listDirectory(path: string): Promise<readonly DirectoryEntry[]> {
		const cached = this.directories.get(path);
		if (cached !== undefined) return cached;
		const entries = await this.requestDirectory(path);
		this.directories.set(path, entries);
		return entries;
	}

	private async requestDirectory(path: string): Promise<readonly DirectoryEntry[]> {
		this.signal.throwIfAborted();
		const location = this.location(path);
		if (location === null) return [];
		try {
			const response = await this.source.getContent(location);
			const parsed = DIRECTORY_SCHEMA.safeParse(response.data);
			if (!parsed.success) {
				this.files.set(path, invalidContextFile(path));
				return [];
			}
			return parsed.data.filter((entry) => validDirectoryChild(path, entry));
		} catch (error) {
			this.signal.throwIfAborted();
			const failure = contextRequestFailure(error, path);
			if (failure.kind !== "missing") this.files.set(path, failure);
			return [];
		}
	}

	private async loadFile(path: string): Promise<void> {
		if (!this.files.has(path)) this.files.set(path, await this.requestFile(path));
	}

	private async requestFile(path: string): Promise<ReviewContextFile> {
		this.signal.throwIfAborted();
		const location = this.location(path);
		if (location === null)
			return { kind: "unavailable", path, reason: "head_repository_unavailable" };
		try {
			const response = await this.source.getContent(location);
			return await this.parseFileData(response.data, location);
		} catch (error) {
			this.signal.throwIfAborted();
			return contextRequestFailure(error, path);
		}
	}

	private async parseFileData(
		data: unknown,
		location: GitHubReviewContentLocation,
	): Promise<ReviewContextFile> {
		const parsed = FILE_CONTENT_SCHEMA.safeParse(data);
		if (!parsed.success) return invalidContextFile(location.path);
		const content =
			parsed.data.encoding === "none"
				? await this.readRawFile(location, parsed.data.size)
				: decodeTextContent(parsed.data.content, parsed.data.size);
		return content === null
			? invalidContextFile(location.path)
			: { kind: "loaded", path: location.path, content };
	}

	private async readRawFile(
		location: GitHubReviewContentLocation,
		size: number,
	): Promise<string | null> {
		const response = await this.source.getContent({
			...location,
			headers: { accept: "application/vnd.github.raw+json" },
		});
		const content = z.string().safeParse(response.data);
		if (!content.success) return null;
		return validRawText(content.data, size) ? content.data : null;
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

function invalidContextFile(path: string): ReviewContextFile {
	return { kind: "unavailable", path, reason: "invalid_response" };
}

function contextRequestFailure(error: unknown, path: string): ReviewContextFile {
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
