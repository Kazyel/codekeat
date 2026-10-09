import { createHash } from "node:crypto";
import { Cache, Effect, Fiber } from "effect";
import { z } from "zod";

import type {
	ReviewSourceCatalog,
	ReviewSourceDocument,
	ReviewSourceEntry,
	ReviewSourceIdentity,
	ReviewSourceListPage,
	ReviewSourceListRequest,
	ReviewSourceReadRequest,
	ReviewSourceReadResult,
	ReviewSourceReference,
	ReviewSourceRelatedRequest,
	ReviewSourceRevision,
	ReviewSourceRole,
	ReviewSourceSearchMatch,
	ReviewSourceSearchPage,
	ReviewSourceSearchRequest,
	ReviewSourceUnavailable,
} from "../types/review-source.types.js";
import {
	isRepositoryPath,
	reviewSupportingPathCandidates,
} from "../utils/review-source-paths.util.js";
import {
	readReviewSourceRange,
	reviewSourceLineOffset,
} from "../utils/review-source-range.util.js";
import { ReviewSourceArtifactService } from "./review-source-artifact.service.js";

type MissingSource = { readonly kind: "missing"; readonly source: ReviewSourceIdentity };
export interface ReviewSourceBackend {
	entries(
		role: ReviewSourceRole,
	): Effect.Effect<readonly ReviewSourceEntry[], ReviewSourceUnavailable>;
	document(
		source: ReviewSourceIdentity,
	): Effect.Effect<ReviewSourceDocument, ReviewSourceUnavailable | MissingSource>;
}
const CURSOR_SCHEMA = z.object({
	key: z.string(),
	index: z.number().int().nonnegative(),
	line: z.number().int().positive(),
	column: z.number().int().nonnegative(),
});
type Cursor = z.infer<typeof CURSOR_SCHEMA>;
interface ContentSearchProgress {
	readonly matches: ReviewSourceSearchMatch[];
	readonly unavailable: (ReviewSourceUnavailable & { readonly source: ReviewSourceIdentity })[];
	cursor: Cursor;
	scannedSources: number;
}
type SearchDocumentResult =
	| { readonly kind: "document"; readonly document: ReviewSourceDocument }
	| { readonly kind: "failure"; readonly failure: ReviewSourceUnavailable | MissingSource };

/** GitHub originals and captured PR/MCP artifacts share one read-only paginated port. */
export class ReviewSourceCatalogService implements ReviewSourceCatalog {
	private readonly captured = new Map<string, ReviewSourceDocument>();
	private readonly captures: Cache.Cache<string, ReviewSourceReference, ReviewSourceUnavailable>;
	constructor(
		readonly revisions: readonly ReviewSourceRevision[],
		private readonly backend: ReviewSourceBackend,
		private readonly artifacts: ReviewSourceArtifactService,
		documents: readonly ReviewSourceDocument[],
	) {
		for (const document of documents) this.captured.set(document.source.path, document);
		this.captures = Effect.runSync(
			Cache.make({
				capacity: Number.MAX_SAFE_INTEGER,
				lookup: (path: string) =>
					artifactEffect((signal) =>
						this.artifacts.write(this.captured.get(path)!, signal),
					),
			}),
		);
	}

	list(
		request: ReviewSourceListRequest,
		signal: AbortSignal,
	): Promise<ReviewSourceListPage | ReviewSourceUnavailable> {
		return Effect.runPromise(
			this.entries(request.role).pipe(
				Effect.map((entries) =>
					sourcePage(
						entries.filter((entry) => entry.path.startsWith(request.prefix)),
						request,
						cursorKey(this.revisions, ["list", request.role, request.prefix]),
					),
				),
				Effect.catch((failure) => Effect.succeed(failure)),
			),
			{ signal },
		);
	}

	read(request: ReviewSourceReadRequest, signal: AbortSignal): Promise<ReviewSourceReadResult> {
		return Effect.runPromise(
			this.document(request.source).pipe(
				Effect.map((document) => readReviewSourceRange(document, request.range)),
				Effect.catch((failure) => Effect.succeed({ ...failure, source: request.source })),
			),
			{ signal },
		);
	}

	search(
		request: ReviewSourceSearchRequest,
		signal: AbortSignal,
	): Promise<ReviewSourceSearchPage | ReviewSourceUnavailable> {
		return Effect.runPromise(
			this.searchEffect(request).pipe(Effect.catch((failure) => Effect.succeed(failure))),
			{ signal },
		);
	}

	related(
		request: ReviewSourceRelatedRequest,
		signal: AbortSignal,
	): Promise<ReviewSourceListPage | ReviewSourceUnavailable> {
		const effect = Effect.gen({ self: this }, function* () {
			const document = yield* this.document(request.source);
			const candidates = new Set(
				reviewSupportingPathCandidates(request.source.path, document.content),
			);
			const entries = yield* this.entries(request.source.role);
			return sourcePage(
				entries.filter((entry) => candidates.has(entry.path)),
				{ ...request, role: request.source.role, prefix: "" },
				cursorKey(this.revisions, [
					"related",
					request.source.role,
					request.source.path,
					document.source.contentHash ?? "",
				]),
			);
		});
		return Effect.runPromise(
			effect.pipe(
				Effect.catch((failure) =>
					Effect.succeed({
						kind: "unavailable" as const,
						reason:
							failure.kind === "missing"
								? ("invalid_request" as const)
								: failure.reason,
					}),
				),
			),
			{ signal },
		);
	}

	async recordInvestigation(
		tool: string,
		argumentsJson: string,
		responseJson: string,
		signal: AbortSignal,
	): Promise<ReviewSourceReference> {
		const path = `mcp/${hash(JSON.stringify([tool, argumentsJson, responseJson]))}`;
		return this.artifacts.write(
			{
				source: {
					role: "investigation",
					path,
					repositoryFullName: null,
					revision: "unconfirmed",
					contentHash: `sha256:${hash(responseJson)}`,
				},
				content: responseJson,
			},
			signal,
		);
	}

	private entries(
		role: ReviewSourceRole,
	): Effect.Effect<readonly ReviewSourceEntry[], ReviewSourceUnavailable> {
		if (role === "investigation")
			return artifactEffect((signal) => this.artifacts.list(role, signal));
		if (role !== "pull_request") return this.backend.entries(role);
		return Effect.succeed(
			[...this.captured.values()].map((document) => ({
				...document.source,
				kind: "file" as const,
				sizeBytes: Buffer.byteLength(document.content),
			})),
		);
	}

	private document(
		source: ReviewSourceIdentity,
	): Effect.Effect<ReviewSourceDocument, ReviewSourceUnavailable | MissingSource> {
		if (!isRepositoryPath(source.path))
			return Effect.fail({ kind: "unavailable", reason: "invalid_request" });
		if (isRepositoryRole(source.role)) return this.backend.document(source);
		if (source.role === "investigation") return this.artifactDocument(source);
		return this.capturedDocument(source);
	}

	private capturedDocument(
		source: ReviewSourceIdentity,
	): Effect.Effect<ReviewSourceDocument, ReviewSourceUnavailable | MissingSource> {
		const captured = this.captured.get(source.path);
		if (captured === undefined) return this.artifactDocument(source);
		if (source.contentHash != null && source.contentHash !== captured.source.contentHash)
			return this.artifactDocument(source);
		return Cache.get(this.captures, source.path).pipe(
			Effect.flatMap((reference) => this.artifactDocument(reference)),
		);
	}

	private artifactDocument(
		source: ReviewSourceIdentity,
	): Effect.Effect<ReviewSourceDocument, ReviewSourceUnavailable | MissingSource> {
		return artifactEffect((signal) => this.artifacts.read(source, signal)).pipe(
			Effect.flatMap((document) =>
				document === null
					? Effect.fail({ kind: "missing" as const, source })
					: Effect.succeed(document),
			),
		);
	}

	private searchEffect(
		request: ReviewSourceSearchRequest,
	): Effect.Effect<ReviewSourceSearchPage, ReviewSourceUnavailable> {
		return Effect.gen({ self: this }, function* () {
			if (!validSearch(request)) return yield* Effect.fail(invalidRequest());
			const entries = (yield* this.entries(request.role)).filter(
				(entry) => entry.kind === "file" && entry.path.startsWith(request.prefix),
			);
			const key = cursorKey(this.revisions, [
				"search",
				request.role,
				request.mode,
				request.query,
				request.prefix,
			]);
			const cursor = parseCursor(request.cursor, key);
			if (cursor === null) return yield* Effect.fail(invalidRequest());
			if (request.mode === "path") return pathSearch(entries, request, cursor, key);
			return yield* this.contentSearch(entries, request, cursor, key);
		});
	}

	private contentSearch(
		entries: readonly ReviewSourceEntry[],
		request: ReviewSourceSearchRequest,
		initial: Cursor,
		key: string,
	): Effect.Effect<ReviewSourceSearchPage> {
		return Effect.gen({ self: this }, function* () {
			const state: ContentSearchProgress = {
				matches: [],
				unavailable: [],
				cursor: initial,
				scannedSources: 0,
			};
			while (
				canScan(
					state.cursor.index,
					entries.length,
					state.scannedSources,
					request.scanLimit,
					state.matches.length,
					request.limit,
				)
			) {
				yield* this.searchBatch(
					entries.slice(
						state.cursor.index,
						state.cursor.index + Math.min(4, request.scanLimit - state.scannedSources),
					),
					request,
					state,
				);
			}

			return {
				kind: "page",
				matches: state.matches,
				scannedSources: state.scannedSources,
				totalSources: entries.length,
				unavailable: state.unavailable,
				nextCursor:
					state.cursor.index < entries.length
						? encodeCursor({ ...state.cursor, key })
						: null,
			};
		});
	}

	private searchBatch(
		entries: readonly ReviewSourceEntry[],
		request: ReviewSourceSearchRequest,
		state: ContentSearchProgress,
	): Effect.Effect<void> {
		return Effect.scoped(
			Effect.gen({ self: this }, function* () {
				const reads = yield* Effect.forEach(
					entries,
					(entry) =>
						Effect.forkScoped(
							this.document(entry).pipe(
								Effect.map((document): SearchDocumentResult => ({
									kind: "document",
									document,
								})),
								Effect.catch((failure) =>
									Effect.succeed({ kind: "failure" as const, failure }),
								),
							),
						).pipe(Effect.map((fiber) => ({ entry, fiber }))),
					{ concurrency: 4 },
				);
				for (const { entry, fiber } of reads) {
					if (state.matches.length >= request.limit) break;
					const result = yield* Fiber.join(fiber);
					const scanned = scanSearchResult(
						result,
						entry,
						request.query,
						state.cursor,
						request.limit - state.matches.length,
					);
					state.scannedSources++;
					state.matches.push(...scanned.matches);
					state.unavailable.push(...scanned.unavailable);
					state.cursor = scanned.cursor;
				}
			}),
		);
	}
}

function sourcePage(
	entries: readonly ReviewSourceEntry[],
	request: ReviewSourceListRequest,
	key: string,
): ReviewSourceListPage | ReviewSourceUnavailable {
	if (!validPage(request)) return invalidRequest();
	const cursor = parseCursor(request.cursor, key);
	if (cursor === null) return invalidRequest();
	const end = Math.min(entries.length, cursor.index + request.limit);
	return {
		kind: "page",
		entries: entries.slice(cursor.index, end),
		totalEntries: entries.length,
		nextCursor:
			end < entries.length ? encodeCursor({ key, index: end, line: 1, column: 0 }) : null,
	};
}

function pathSearch(
	entries: readonly ReviewSourceEntry[],
	request: ReviewSourceSearchRequest,
	cursor: Cursor,
	key: string,
): ReviewSourceSearchPage {
	const found = entries.filter((entry) => entry.path.includes(request.query));
	const end = Math.min(found.length, cursor.index + request.limit);
	return {
		kind: "page",
		matches: found.slice(cursor.index, end).map((source) => ({
			source,
			line: 0,
			column: source.path.indexOf(request.query),
			length: request.query.length,
		})),
		totalSources: entries.length,
		scannedSources: entries.length,
		unavailable: [],
		nextCursor:
			end < found.length ? encodeCursor({ key, index: end, line: 1, column: 0 }) : null,
	};
}

function scanSearchResult(
	result:
		| { readonly kind: "document"; readonly document: ReviewSourceDocument }
		| { readonly kind: "failure"; readonly failure: ReviewSourceUnavailable | MissingSource },
	source: ReviewSourceEntry,
	query: string,
	cursor: Cursor,
	limit: number,
): {
	readonly matches: readonly ReviewSourceSearchMatch[];
	readonly unavailable: readonly (ReviewSourceUnavailable & {
		readonly source: ReviewSourceIdentity;
	})[];
	readonly cursor: Cursor;
} {
	if (result.kind === "document")
		return { ...scanDocument(result.document, query, cursor, limit), unavailable: [] };
	return {
		matches: [],
		unavailable: [
			{
				kind: "unavailable",
				reason:
					result.failure.kind === "missing" ? "request_failed" : result.failure.reason,
				source,
			},
		],
		cursor: { ...cursor, index: cursor.index + 1, line: 1, column: 0 },
	};
}

function scanDocument(
	document: ReviewSourceDocument,
	query: string,
	cursor: Cursor,
	limit: number,
): { readonly matches: readonly ReviewSourceSearchMatch[]; readonly cursor: Cursor } {
	const matches: ReviewSourceSearchMatch[] = [];
	let position = {
		line: cursor.line,
		offset: reviewSourceLineOffset(document.content, cursor.line),
	};
	let offset = position.offset + cursor.column;
	while (offset < document.content.length) {
		const found = document.content.indexOf(query, offset);
		if (found === -1) break;
		position = advancePosition(document.content, position, found);
		matches.push({
			source: document.source,
			line: position.line,
			column: found - position.offset,
			length: query.length,
		});
		offset = found + query.length;
		position = advancePosition(document.content, position, offset);
		if (matches.length === limit)
			return {
				matches,
				cursor: { ...cursor, line: position.line, column: offset - position.offset },
			};
	}
	return { matches, cursor: { ...cursor, index: cursor.index + 1, line: 1, column: 0 } };
}

function advancePosition(
	content: string,
	initial: { readonly line: number; readonly offset: number },
	target: number,
): { readonly line: number; readonly offset: number } {
	let line = initial.line;
	let offset = initial.offset;
	let newline = content.indexOf("\n", offset);
	while (newline !== -1 && newline < target) {
		line++;
		offset = newline + 1;
		newline = content.indexOf("\n", offset);
	}
	return { line, offset };
}
function isRepositoryRole(role: ReviewSourceRole): boolean {
	return role === "head" || role === "before";
}
function canScan(
	index: number,
	count: number,
	scanned: number,
	scanLimit: number,
	hits: number,
	limit: number,
): boolean {
	return index < count && scanned < scanLimit && hits < limit;
}
function validPage(request: ReviewSourceListRequest): boolean {
	return Number.isSafeInteger(request.limit) && request.limit > 0 && validPrefix(request.prefix);
}
function validSearch(request: ReviewSourceSearchRequest): boolean {
	return (
		validPage(request) &&
		request.query.length > 0 &&
		Number.isSafeInteger(request.scanLimit) &&
		request.scanLimit > 0
	);
}
function validPrefix(prefix: string): boolean {
	return prefix === "" || isRepositoryPath(prefix.replace(/\/$/, ""));
}
function invalidRequest(): ReviewSourceUnavailable {
	return { kind: "unavailable", reason: "invalid_request" };
}
function cursorKey(revisions: readonly ReviewSourceRevision[], query: readonly string[]): string {
	return hash(JSON.stringify([revisions, query]));
}
function hash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}
function encodeCursor(cursor: Cursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function parseCursor(value: string | null, key: string): Cursor | null {
	if (value === null) return { key, index: 0, line: 1, column: 0 };
	try {
		const parsed = CURSOR_SCHEMA.safeParse(
			JSON.parse(Buffer.from(value, "base64url").toString()),
		);
		return parsed.success && parsed.data.key === key ? parsed.data : null;
	} catch {
		return null;
	}
}
function artifactEffect<A>(
	request: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, ReviewSourceUnavailable> {
	return Effect.tryPromise({
		try: request,
		catch: (): ReviewSourceUnavailable => ({ kind: "unavailable", reason: "invalid_response" }),
	});
}
