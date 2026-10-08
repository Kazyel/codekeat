import { Buffer } from "node:buffer";
import { z } from "zod";

import type {
	ReviewContextFile,
	ReviewInputChunk,
	ReviewRepositoryContext,
} from "#features/review";

const CONTEXT_DOCUMENT_PATHS = [
	".codekeat/README.md",
	".codekeat/domain.md",
	".codekeat/integrations.md",
];
const MAXIMUM_CONTEXT_REQUESTS = 12;
const MAXIMUM_DOCUMENT_LENGTH = 12_000;
const MAXIMUM_CODE_LENGTH = 24_000;
const MAXIMUM_CONTEXT_LENGTH = 64_000;
const FILE_CONTENT_SCHEMA = z.object({
	type: z.literal("file"),
	encoding: z.literal("base64"),
	content: z.string().max(1_500_000),
	size: z.number().int().nonnegative().max(1_000_000),
	target: z.never().optional(),
	submodule_git_url: z.never().optional(),
});
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TEXT_CONTROL_BYTES = new Set([9, 10, 13]);

export type GitHubReviewContentLocation = {
	readonly owner: string;
	readonly repo: string;
	readonly path: string;
	readonly ref: string;
};

export interface GitHubReviewContentSource {
	getContent(location: GitHubReviewContentLocation): Promise<{ readonly data: unknown }>;
}

export async function loadGitHubReviewContext(
	source: GitHubReviewContentSource,
	repositoryFullName: string | null,
	revision: string,
	chunks: readonly ReviewInputChunk[],
): Promise<ReviewRepositoryContext> {
	const changedPaths = changedFilePaths(chunks);
	const paths = [...CONTEXT_DOCUMENT_PATHS, ...changedPaths];
	const files: ReviewContextFile[] = [];
	let remainingLength = MAXIMUM_CONTEXT_LENGTH;
	let selectedChangedFiles = 0;

	for (const path of paths.slice(0, MAXIMUM_CONTEXT_REQUESTS)) {
		if (remainingLength === 0) {
			break;
		}
		const limit = Math.min(fileLengthLimit(path), remainingLength);
		const file = await loadContextFile(source, repositoryFullName, revision, path, limit);
		files.push(file);
		remainingLength -= contextFileLength(file);
		selectedChangedFiles += changedPaths.includes(path) ? 1 : 0;
	}

	return {
		repositoryFullName,
		revision,
		files,
		omittedFileCount: changedPaths.length - selectedChangedFiles,
	};
}

function changedFilePaths(chunks: readonly ReviewInputChunk[]): readonly string[] {
	const paths = new Set<string>();
	for (const chunk of chunks) {
		for (const [path, lines] of chunk.changedLines) {
			if (lines.size > 0 && !CONTEXT_DOCUMENT_PATHS.includes(path)) {
				paths.add(path);
			}
		}
	}
	return [...paths];
}

function fileLengthLimit(path: string): number {
	return CONTEXT_DOCUMENT_PATHS.includes(path) ? MAXIMUM_DOCUMENT_LENGTH : MAXIMUM_CODE_LENGTH;
}

function contextFileLength(file: ReviewContextFile): number {
	return file.kind === "loaded" || file.kind === "truncated" ? file.content.length : 0;
}

async function loadContextFile(
	source: GitHubReviewContentSource,
	repositoryFullName: string | null,
	revision: string,
	path: string,
	limit: number,
): Promise<ReviewContextFile> {
	if (repositoryFullName === null) {
		return { kind: "unavailable", path, reason: "head_repository_unavailable" };
	}
	const [owner, repo] = repositoryFullName.split("/");
	if (owner === undefined || repo === undefined) {
		return { kind: "unavailable", path, reason: "head_repository_unavailable" };
	}
	try {
		const response = await source.getContent({ owner, repo, path, ref: revision });
		return parseContextFile(response.data, path, limit);
	} catch (error) {
		return contextRequestFailure(error, path);
	}
}

function contextRequestFailure(error: unknown, path: string): ReviewContextFile {
	if (typeof error === "object" && error !== null && "status" in error && error.status === 404) {
		return { kind: "missing", path };
	}
	return { kind: "unavailable", path, reason: "request_failed" };
}

function parseContextFile(data: unknown, path: string, limit: number): ReviewContextFile {
	const result = FILE_CONTENT_SCHEMA.safeParse(data);
	if (!result.success) {
		return { kind: "unavailable", path, reason: "invalid_response" };
	}
	const content = decodeTextContent(result.data.content, result.data.size);
	if (content === null) {
		return { kind: "unavailable", path, reason: "invalid_response" };
	}
	return content.length > limit
		? { kind: "truncated", path, content: content.slice(0, limit) }
		: { kind: "loaded", path, content };
}

function decodeTextContent(encoded: string, size: number): string | null {
	const canonical = encoded.replace(/[\r\n]/g, "");
	if (!BASE64_PATTERN.test(canonical)) {
		return null;
	}
	const bytes = Buffer.from(canonical, "base64");
	if (!validTextBytes(bytes, size, canonical)) {
		return null;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

function validTextBytes(bytes: Buffer, size: number, canonical: string): boolean {
	const binary = bytes.some(
		(byte) => (byte < 32 && !TEXT_CONTROL_BYTES.has(byte)) || byte === 127,
	);
	return bytes.length === size && bytes.toString("base64") === canonical && !binary;
}
