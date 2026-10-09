import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewSourceArtifactService } from "../src/features/review/services/review-source-artifact.service.js";
import {
	ReviewSourceCatalogService,
	type ReviewSourceBackend,
} from "../src/features/review/services/review-source-catalog.service.js";
import type {
	ReviewSourceCatalog,
	ReviewSourceDocument,
	ReviewSourceEntry,
	ReviewSourceIdentity,
	ReviewSourceRange,
	ReviewSourceReference,
	ReviewSourceRevision,
	ReviewSourceRole,
	ReviewSourceSearchMatch,
	ReviewSourceSearchRequest,
	ReviewSourceUnavailable,
} from "../src/features/review/types/review-source.types.js";

const signal = new AbortController().signal;
const revision: ReviewSourceRevision = {
	role: "head",
	repositoryFullName: "takeat/codekeat",
	revision: "a".repeat(40),
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("Review source catalog", () => {
	it("returns an available match and cancels speculative reads without waiting for an unrelated stalled document", async () => {
		const documents = Array.from({ length: 4 }, (_, index) =>
			sourceDocument("head", `src/${index}.ts`, "needle"),
		);
		const aborted: string[] = [];
		const firstRead = Promise.withResolvers<ReviewSourceDocument>();
		let stalledReads = 0;
		const backend: ReviewSourceBackend = {
			entries: () =>
				Effect.succeed(
					documents.map((document) => ({
						...document.source,
						kind: "file",
						sizeBytes: 6,
					})),
				),
			document: (identity) =>
				identity.path === "src/0.ts"
					? Effect.promise(() => firstRead.promise)
					: Effect.promise(
							(signal) =>
								new Promise<ReviewSourceDocument>((_resolve, reject) => {
									stalledReads++;
									signal.addEventListener(
										"abort",
										() => {
											aborted.push(identity.path);
											reject(new Error("Aborted"));
										},
										{ once: true },
									);
								}),
						),
		};
		const catalog = new ReviewSourceCatalogService(
			[revision],
			backend,
			new ReviewSourceArtifactService(await artifactDirectory(), "cancel-prefetch"),
			[],
		);
		const pending = catalog.search(
			{ ...contentSearchRequest("needle"), limit: 1, scanLimit: 4 },
			signal,
		);
		await vi.waitFor(() => expect(stalledReads).toBe(3));
		firstRead.resolve(documents[0]!);
		const result = await pending;
		expect(result).toMatchObject({
			kind: "page",
			matches: [{ source: { path: "src/0.ts" } }],
			scannedSources: 1,
		});
		expect(aborted.sort()).toEqual(["src/1.ts", "src/2.ts", "src/3.ts"]);
	});
	it("reads independent scan sources concurrently with at most four live documents and retains match order", async () => {
		const documents = Array.from({ length: 8 }, (_, index) =>
			sourceDocument("head", `src/${index}.ts`, "needle"),
		);
		const waiting = new Map<string, (document: ReviewSourceDocument) => void>();
		let active = 0;
		let peak = 0;
		const backend: ReviewSourceBackend = {
			entries: () =>
				Effect.succeed(
					documents.map((document) => ({
						...document.source,
						kind: "file",
						sizeBytes: 6,
					})),
				),
			document: (identity) =>
				Effect.promise(
					() =>
						new Promise<ReviewSourceDocument>((resolve) => {
							active++;
							peak = Math.max(peak, active);
							waiting.set(identity.path, (document) => {
								active--;
								resolve(document);
							});
						}),
				),
		};
		const catalog = new ReviewSourceCatalogService(
			[revision],
			backend,
			new ReviewSourceArtifactService(await artifactDirectory(), "parallel"),
			[],
		);
		const pending = catalog.search(
			{ ...contentSearchRequest("needle"), limit: 9, scanLimit: 8 },
			signal,
		);
		for (let batch = 0; batch < 2; batch++) {
			await vi.waitFor(() => expect(waiting.size).toBe(4));
			// Resolve in reverse order; pagination must retain repository order.
			for (const document of documents.slice(batch * 4, batch * 4 + 4).reverse()) {
				waiting.get(document.source.path)!(document);
				waiting.delete(document.source.path);
			}
		}
		expect(peak).toBe(4);
		const result = await pending;
		if (result.kind !== "page") throw new Error("Expected completed search");
		expect(result.matches.map((match) => match.source.path)).toEqual(
			documents.map((document) => document.source.path),
		);
		expect(result.nextCursor).toBeNull();
	});
	it("reassembles a captured PR description without losing BOM, CRLF, blank lines or UTF16 surrogate pairs", async () => {
		const description = "\uFEFFDescrição original\r\n💡 e 𠜎\n\nÚltima linha";
		const document = sourceDocument("pull_request", "description.md", description);
		const catalog = await createCatalog([], [document]);

		const pages = await readColumns(catalog, document.source);

		expect(pages.content).toBe(description);
		expect(Buffer.from(pages.content)).toEqual(Buffer.from(description));
		expect(pages.reference.contentHash).toBe(contentHash(description));
		const whole = await catalog.read(
			{
				source: pages.reference,
				range: { kind: "lines", startLine: 1, lineCount: 4 },
			},
			signal,
		);
		expect(whole).toMatchObject({ kind: "loaded", content: description, totalLines: 4 });
	});

	it("reopens full investigation responses after recreating the catalog and keeps its artifacts private", async () => {
		const directory = await artifactDirectory();
		const response = JSON.stringify({
			result: `💡${"original ".repeat(2_000)}`,
			source: "Takeat",
		});
		const catalog = catalogAt(directory);
		const reference = await catalog.recordInvestigation(
			"takeat_read",
			JSON.stringify({ repository: "takeat/api" }),
			response,
			signal,
		);
		const restored = catalogAt(directory);

		expect(reference).toMatchObject({
			role: "investigation",
			repositoryFullName: null,
			revision: "unconfirmed",
			contentHash: contentHash(response),
		});
		expect(
			await restored.read(
				{ source: reference, range: { kind: "lines", startLine: 1, lineCount: 1 } },
				signal,
			),
		).toMatchObject({ kind: "loaded", source: reference, content: response });
		expect(
			await restored.list(
				{ role: "investigation", prefix: "", cursor: null, limit: 10 },
				signal,
			),
		).toMatchObject({ kind: "page", entries: [reference], nextCursor: null });

		const runDirectory = join(directory, (await readdir(directory))[0]!);
		expect((await stat(runDirectory)).mode & 0o777).toBe(0o700);
		for (const file of await readdir(runDirectory))
			expect((await stat(join(runDirectory, file))).mode & 0o777).toBe(0o600);
	});

	it("keeps earlier captured versions addressable by hash and isolates artifacts between review runs", async () => {
		const directory = await artifactDirectory();
		const original = sourceDocument("pull_request", "description.md", "Original intention\n");
		const initial = catalogAt(directory, [], [original]);
		const stored = await initial.read(
			{ source: original.source, range: { kind: "lines", startLine: 1, lineCount: 1 } },
			signal,
		);
		if (stored.kind !== "loaded") throw new Error("The initial description was not captured.");
		const edited = sourceDocument("pull_request", "description.md", "Edited intention\n");
		const retried = catalogAt(directory, [], [edited]);

		expect(
			await retried.read(
				{
					source: { role: "pull_request", path: "description.md" },
					range: { kind: "lines", startLine: 1, lineCount: 1 },
				},
				signal,
			),
		).toMatchObject({ kind: "loaded", content: "Edited intention\n" });
		expect(
			await retried.read(
				{ source: stored.source, range: { kind: "lines", startLine: 1, lineCount: 1 } },
				signal,
			),
		).toMatchObject({ kind: "loaded", source: stored.source, content: "Original intention\n" });
		const separateRun = catalogAt(directory, [], [], "different-review-run");
		expect(
			await separateRun.read(
				{ source: stored.source, range: { kind: "lines", startLine: 1, lineCount: 1 } },
				signal,
			),
		).toEqual({ kind: "missing", source: stored.source });
	});

	it("resumes content searches within a source and reports exact positions for repeated and multiline matches", async () => {
		const documents = [
			sourceDocument("head", "src/a.ts", "💡 needle needle\nprefix\nsuffix needle\nneedle\n"),
			sourceDocument("head", "src/b.ts", "needle\nprefix needle\nprefix"),
		];
		const catalog = await createCatalog(documents);
		const repeated = await searchPages(catalog, "needle");
		const multiline = await searchPages(catalog, "needle\nprefix");

		expect(repeated.map(matchPosition)).toEqual([
			["src/a.ts", 1, 3, 6],
			["src/a.ts", 1, 10, 6],
			["src/a.ts", 3, 7, 6],
			["src/a.ts", 4, 0, 6],
			["src/b.ts", 1, 0, 6],
			["src/b.ts", 2, 7, 6],
		]);
		expect(multiline.map(matchPosition)).toEqual([
			["src/a.ts", 1, 10, 13],
			["src/b.ts", 1, 0, 13],
			["src/b.ts", 2, 7, 13],
		]);
	});

	it("rejects malformed cursors and cursors from another prefix, query or revision", async () => {
		const documents = [
			sourceDocument("head", "src/a.ts", "needle needle"),
			sourceDocument("head", "src/b.ts", "needle"),
		];
		const directory = await artifactDirectory();
		const catalog = catalogAt(directory, documents);
		const request = { role: "head", prefix: "src/", cursor: null, limit: 1 } as const;
		const listed = await catalog.list(request, signal);
		if (listed.kind !== "page") throw new Error("Expected an initial source page.");
		expect(listed.nextCursor).not.toBeNull();
		const invalid = { kind: "unavailable", reason: "invalid_request" };

		expect(await catalog.list({ ...request, cursor: "invalid cursor" }, signal)).toEqual(
			invalid,
		);
		expect(
			await catalog.list({ ...request, prefix: "tests/", cursor: listed.nextCursor }, signal),
		).toEqual(invalid);
		const otherRevision = new ReviewSourceCatalogService(
			[{ ...revision, revision: "b".repeat(40) }],
			new SourceFixture(documents),
			new ReviewSourceArtifactService(directory, "same-review-run"),
			[],
		);
		expect(await otherRevision.list({ ...request, cursor: listed.nextCursor }, signal)).toEqual(
			invalid,
		);
		const searchRequest = contentSearchRequest("needle");
		const searched = await catalog.search(searchRequest, signal);
		if (searched.kind !== "page") throw new Error("Expected an initial search page.");
		expect(
			await catalog.search(
				{ ...searchRequest, query: "other", cursor: searched.nextCursor },
				signal,
			),
		).toEqual(invalid);
	});

	it("reports missing sources, unavailable revisions and failed content scans as distinct outcomes", async () => {
		const directory = await artifactDirectory();
		const document = sourceDocument("head", "src/private.ts", "needle");
		const backend = new SourceFixture(
			[document],
			new Map([["head:src/private.ts", { kind: "unavailable", reason: "request_failed" }]]),
			new Set(["before"]),
		);
		const catalog = new ReviewSourceCatalogService(
			[revision],
			backend,
			new ReviewSourceArtifactService(directory, "same-review-run"),
			[],
		);
		const missing: ReviewSourceIdentity = { role: "head", path: "src/missing.ts" };
		const range: ReviewSourceRange = { kind: "lines", startLine: 1, lineCount: 1 };

		expect(await catalog.read({ source: missing, range }, signal)).toEqual({
			kind: "missing",
			source: missing,
		});
		expect(await catalog.read({ source: document.source, range }, signal)).toEqual({
			kind: "unavailable",
			reason: "request_failed",
			source: document.source,
		});
		expect(
			await catalog.list({ role: "before", prefix: "", cursor: null, limit: 10 }, signal),
		).toEqual({ kind: "unavailable", reason: "revision_unavailable" });
		expect(await catalog.search(contentSearchRequest("needle"), signal)).toMatchObject({
			kind: "page",
			matches: [],
			unavailable: [
				{ kind: "unavailable", reason: "request_failed", source: document.source },
			],
			nextCursor: null,
		});
	});

	it("refuses persisted content whose bytes no longer match its recorded hash", async () => {
		const directory = await artifactDirectory();
		const catalog = catalogAt(directory);
		const reference = await catalog.recordInvestigation(
			"read",
			"{}",
			'{"value":"original"}',
			signal,
		);
		const runDirectory = join(directory, (await readdir(directory))[0]!);
		const blob = (await readdir(runDirectory)).find((name) => name.endsWith(".blob"));
		if (blob === undefined) throw new Error("The investigation blob was not persisted.");
		const bytes = await readFile(join(runDirectory, blob));
		bytes[0] = bytes[0]! ^ 1;
		await writeFile(join(runDirectory, blob), bytes);

		expect(
			await catalogAt(directory).read(
				{ source: reference, range: { kind: "lines", startLine: 1, lineCount: 1 } },
				signal,
			),
		).toEqual({ kind: "unavailable", reason: "invalid_response", source: reference });
	});
});

class SourceFixture implements ReviewSourceBackend {
	constructor(
		private readonly documents: readonly ReviewSourceDocument[],
		private readonly failures: ReadonlyMap<string, ReviewSourceUnavailable> = new Map(),
		private readonly unavailableRoles: ReadonlySet<ReviewSourceRole> = new Set(),
	) {}

	entries(
		role: ReviewSourceRole,
	): Effect.Effect<readonly ReviewSourceEntry[], ReviewSourceUnavailable> {
		if (this.unavailableRoles.has(role))
			return Effect.fail({ kind: "unavailable", reason: "revision_unavailable" });
		return Effect.succeed(
			this.documents
				.filter((document) => document.source.role === role)
				.map((document) => ({
					...document.source,
					kind: "file" as const,
					sizeBytes: Buffer.byteLength(document.content),
				})),
		);
	}

	document(
		source: ReviewSourceIdentity,
	): Effect.Effect<
		ReviewSourceDocument,
		| ReviewSourceUnavailable
		| { readonly kind: "missing"; readonly source: ReviewSourceIdentity }
	> {
		const failure = this.failures.get(`${source.role}:${source.path}`);
		if (failure !== undefined) return Effect.fail(failure);
		const document = this.documents.find(
			(candidate) =>
				candidate.source.role === source.role && candidate.source.path === source.path,
		);
		return document === undefined
			? Effect.fail({ kind: "missing", source })
			: Effect.succeed(document);
	}
}

async function artifactDirectory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "codekeat-source-catalog-"));
	temporaryDirectories.push(path);
	return path;
}

async function createCatalog(
	documents: readonly ReviewSourceDocument[] = [],
	captured: readonly ReviewSourceDocument[] = [],
): Promise<ReviewSourceCatalogService> {
	return catalogAt(await artifactDirectory(), documents, captured);
}

function catalogAt(
	directory: string,
	documents: readonly ReviewSourceDocument[] = [],
	captured: readonly ReviewSourceDocument[] = [],
	reviewRunId = "same-review-run",
): ReviewSourceCatalogService {
	return new ReviewSourceCatalogService(
		[revision],
		new SourceFixture(documents),
		new ReviewSourceArtifactService(directory, reviewRunId),
		captured,
	);
}

function sourceDocument(
	role: ReviewSourceRole,
	path: string,
	content: string,
): ReviewSourceDocument {
	return {
		source: {
			...revision,
			role,
			path,
			contentHash: contentHash(content),
		},
		content,
	};
}

function contentHash(content: string): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function readColumns(
	catalog: ReviewSourceCatalog,
	source: ReviewSourceIdentity,
): Promise<{ readonly content: string; readonly reference: ReviewSourceReference }> {
	let range: ReviewSourceRange | null = {
		kind: "columns",
		line: 1,
		startColumn: 0,
		columnCount: 1,
	};
	let content = "";
	let reference: ReviewSourceReference | null = null;
	for (let pages = 0; range !== null; pages++) {
		if (pages === 200) throw new Error("Column pagination did not terminate.");
		const page = await catalog.read({ source, range }, signal);
		if (page.kind !== "loaded") throw new Error("Expected a loaded source page.");
		content += page.content;
		reference = page.source;
		range = page.nextRange;
	}
	if (reference === null) throw new Error("Expected at least one source page.");
	return { content, reference };
}

function contentSearchRequest(query: string): ReviewSourceSearchRequest {
	return {
		role: "head",
		prefix: "",
		mode: "content",
		query,
		cursor: null,
		limit: 1,
		scanLimit: 1,
	};
}

async function searchPages(
	catalog: ReviewSourceCatalog,
	query: string,
): Promise<readonly ReviewSourceSearchMatch[]> {
	const request = contentSearchRequest(query);
	const matches: ReviewSourceSearchMatch[] = [];
	let cursor: string | null = null;
	for (let pages = 0; pages < 100; pages++) {
		const page = await catalog.search({ ...request, cursor }, signal);
		if (page.kind !== "page") throw new Error("Expected a search page.");
		expect(page.unavailable).toEqual([]);
		matches.push(...page.matches);
		if (page.nextCursor === null) return matches;
		cursor = page.nextCursor;
	}
	throw new Error("Search pagination did not terminate.");
}

function matchPosition(match: ReviewSourceSearchMatch): readonly [string, number, number, number] {
	return [match.source.path, match.line, match.column, match.length];
}
