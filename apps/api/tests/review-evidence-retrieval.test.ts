import { createHash } from "node:crypto";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";

import {
	ReviewEvidenceRetrievalService,
	reviewEvidenceRetrieval,
} from "../src/features/review/services/review-evidence-retrieval.service.js";
import { ReviewSourceArtifactService } from "../src/features/review/services/review-source-artifact.service.js";
import {
	ReviewSourceCatalogService,
	type ReviewSourceBackend,
} from "../src/features/review/services/review-source-catalog.service.js";
import type {
	ReviewSourceCatalog,
	ReviewSourceDocument,
	ReviewSourceSearchRequest,
} from "../src/features/review/types/review-source.types.js";
import { ReviewSourceTools } from "../src/integrations/gemini/utils/review-source-tools.util.js";

const SEARCH: ReviewSourceSearchRequest = {
	role: "head",
	prefix: "src/",
	cursor: null,
	limit: 10,
	mode: "content",
	query: "calculateCost",
	scanLimit: 20,
};
const signal = new AbortController().signal;

function document(role: "head" | "before", path: string, content: string): ReviewSourceDocument {
	return {
		content,
		source: {
			role,
			path,
			repositoryFullName: "takeat/example",
			revision: role === "head" ? "a".repeat(40) : "b".repeat(40),
			contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
		},
	};
}

function createCatalog(documents: readonly ReviewSourceDocument[]) {
	const reads = vi.fn((source: ReviewSourceDocument["source"]) =>
		documents.find(
			(candidate) =>
				candidate.source.role === source.role && candidate.source.path === source.path,
		),
	);
	const backend: ReviewSourceBackend = {
		entries: (role) =>
			Effect.succeed(
				documents
					.filter((item) => item.source.role === role)
					.map((item) => ({
						...item.source,
						kind: "file" as const,
						sizeBytes: Buffer.byteLength(item.content),
					})),
			),
		document: (source) =>
			Effect.suspend(() => {
				const found = reads({
					...source,
					repositoryFullName: "takeat/example",
					revision: "a".repeat(40),
					contentHash: source.contentHash ?? null,
				});
				return found === undefined
					? Effect.fail({ kind: "missing" as const, source })
					: Effect.succeed(found);
			}),
	};
	const catalog = new ReviewSourceCatalogService(
		[{ role: "head", repositoryFullName: "takeat/example", revision: "a".repeat(40) }],
		backend,
		new ReviewSourceArtifactService("/unused/head-fixture", "fixture"),
		[],
	);
	return { catalog, reads };
}

async function executeSearch(catalog: ReviewSourceCatalog, request: ReviewSourceSearchRequest) {
	const tools = new ReviewSourceTools(catalog, signal).tools();
	const execute = tools.source_search?.execute;
	if (execute === undefined) throw new Error("source_search is not executable");
	return execute(request, { toolCallId: "search", messages: [], abortSignal: signal });
}

describe("Evidence retrieval tools", () => {
	it("returns late matches in one model tool call after traversing 129 sources, and shares repeated lookups", async () => {
		const documents = Array.from({ length: 129 }, (_, index) =>
			document(
				"head",
				`src/file-${index}.ts`,
				index === 128 ? "calculateCost(input)\ncalculateCost(other)" : "unrelated",
			),
		);
		const { catalog, reads } = createCatalog(documents);
		const [first, second] = await Promise.all([
			executeSearch(catalog, SEARCH),
			executeSearch(catalog, SEARCH),
		]);
		const expected = {
			kind: "page",
			status: "complete",
			incompleteReason: null,
			scannedSources: 129,
			totalSources: 129,
			nextCursor: null,
			unavailable: [],
			matches: [
				{ source: documents[128]!.source, line: 1, column: 0, length: 13 },
				{ source: documents[128]!.source, line: 2, column: 0, length: 13 },
			],
		};
		expect(first).toEqual(expected);
		expect(second).toEqual(expected);
		expect(reads).toHaveBeenCalledTimes(129);
		expect(await executeSearch(catalog, SEARCH)).toEqual(expected);
		expect(reads).toHaveBeenCalledTimes(129);
	});

	it("preserves a cursor within one file when a result page fills", async () => {
		const { catalog } = createCatalog([
			document("head", "src/file.ts", "calculateCost calculateCost\ncalculateCost"),
		]);
		const service = reviewEvidenceRetrieval(catalog);
		const first = await Effect.runPromise(service.search({ ...SEARCH, limit: 2 }));
		if (first.kind !== "page") throw new Error("Expected a search page");
		expect(first).toMatchObject({ status: "partial", incompleteReason: "result_limit" });
		expect(first.nextCursor).not.toBeNull();
		const second = await Effect.runPromise(
			service.search({ ...SEARCH, limit: 2, cursor: first.nextCursor }),
		);
		expect(second).toMatchObject({
			status: "complete",
			nextCursor: null,
			matches: [{ line: 2, column: 0 }],
		});
	});

	it("isolates identical queries by role and authorized catalog", async () => {
		const { catalog } = createCatalog([
			document("head", "src/file.ts", "calculateCost"),
			document("before", "src/file.ts", "unrelated"),
		]);
		const second = createCatalog([document("head", "src/file.ts", "unrelated")]).catalog;
		expect(await executeSearch(catalog, SEARCH)).toMatchObject({
			status: "complete",
			matches: [{ line: 1 }],
		});
		expect(await executeSearch(catalog, { ...SEARCH, role: "before" })).toMatchObject({
			status: "complete",
			matches: [],
		});
		expect(await executeSearch(second, SEARCH)).toMatchObject({
			status: "complete",
			matches: [],
		});
	});

	it("keeps unavailable sources partial and retries them instead of caching absence", async () => {
		const { catalog } = createCatalog([document("head", "src/file.ts", "calculateCost")]);
		const search = vi.spyOn(catalog, "search");
		search.mockResolvedValueOnce({
			kind: "page",
			matches: [],
			scannedSources: 1,
			totalSources: 1,
			unavailable: [
				{
					kind: "unavailable",
					reason: "request_failed",
					source: { role: "head", path: "src/file.ts" },
				},
			],
			nextCursor: null,
		});
		expect(await executeSearch(catalog, SEARCH)).toMatchObject({
			kind: "page",
			status: "partial",
			incompleteReason: "source_unavailable",
			matches: [],
		});
		expect(await executeSearch(catalog, SEARCH)).toMatchObject({
			status: "complete",
			matches: [{ line: 1 }],
		});
	});

	it("preserves the last usable cursor on a stalled or failed later page", async () => {
		const { catalog } = createCatalog([]);
		const search = vi.spyOn(catalog, "search");
		search.mockResolvedValue({
			kind: "page",
			matches: [],
			scannedSources: 20,
			totalSources: 129,
			unavailable: [],
			nextCursor: "continue",
		});
		expect(await executeSearch(catalog, SEARCH)).toMatchObject({
			status: "partial",
			incompleteReason: "cursor_stalled",
			nextCursor: "continue",
		});
		search.mockResolvedValueOnce({
			kind: "page",
			matches: [],
			scannedSources: 20,
			totalSources: 129,
			unavailable: [],
			nextCursor: "retry-here",
		});
		search.mockRejectedValueOnce(new Error("transport failed"));
		expect(await executeSearch(catalog, SEARCH)).toMatchObject({
			status: "partial",
			incompleteReason: "request_failed",
			nextCursor: "retry-here",
		});
	});

	it("cancels I/O when the only waiter aborts and permits a fresh lookup afterward", async () => {
		const { catalog } = createCatalog([]);
		let requestSignal: AbortSignal | null = null;
		const search = vi
			.spyOn(catalog, "search")
			.mockImplementationOnce((_request, activeSignal) => {
				requestSignal = activeSignal;
				return new Promise((_resolve, reject) =>
					activeSignal.addEventListener("abort", () => reject(new Error("cancelled")), {
						once: true,
					}),
				);
			});
		const controller = new AbortController();
		const pending = Effect.runPromise(reviewEvidenceRetrieval(catalog).search(SEARCH), {
			signal: controller.signal,
		});
		const assertion = pending.catch(() => "cancelled");
		await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
		controller.abort();
		expect(await assertion).toBe("cancelled");
		expect(requestSignal?.aborted).toBe(true);
		expect(await executeSearch(catalog, SEARCH)).toMatchObject({
			status: "complete",
			matches: [],
		});
	});

	it("returns a deadline as partial with continuation and aborts the active page", async () => {
		const { catalog } = createCatalog([]);
		let requestSignal: AbortSignal | null = null;
		let markStarted: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		vi.spyOn(catalog, "search")
			.mockResolvedValueOnce({
				kind: "page",
				matches: [],
				scannedSources: 20,
				totalSources: 129,
				unavailable: [],
				nextCursor: "remaining",
			})
			.mockImplementationOnce((_request, activeSignal) => {
				requestSignal = activeSignal;
				markStarted();
				return new Promise((_resolve, reject) =>
					activeSignal.addEventListener("abort", () => reject(new Error("cancelled")), {
						once: true,
					}),
				);
			});
		const program = Effect.gen(function* () {
			const service = new ReviewEvidenceRetrievalService(catalog);
			const fiber = yield* Effect.forkChild(service.search(SEARCH));
			yield* Effect.promise(() => started);
			yield* TestClock.adjust("10 seconds");
			return yield* Fiber.join(fiber);
		});
		expect(
			await Effect.runPromise(program.pipe(Effect.provide(TestClock.layer()))),
		).toMatchObject({
			status: "partial",
			incompleteReason: "deadline",
			nextCursor: "remaining",
			scannedSources: 20,
		});
		expect(requestSignal?.aborted).toBe(true);
	});

	it("retrieves exact head/before function ranges, imports/tests, and explicitly lexical occurrences", async () => {
		const head = document(
			"head",
			"src/cost.ts",
			'import { guard } from "./guard.js";\n\nexport function calculateCost(input: number): number {\n  // A brace in a comment: }\n  if (guard(input)) return 0;\n  return input;\n}\n\nexport const unrelated = 1;',
		);
		const before = document(
			"before",
			"src/cost.ts",
			"export function calculateCost(input: number): number {\n  return input;\n}",
		);
		const { catalog } = createCatalog([
			head,
			before,
			document("head", "src/guard.ts", "export const guard = (n: number) => n === 0;"),
			document("head", "src/cost.test.ts", "calculateCost(0)"),
			document("head", "src/caller.ts", "calculateCost(1)"),
		]);
		const result = await Effect.runPromise(
			reviewEvidenceRetrieval(catalog).evidence({
				source: { role: "head", path: "src/cost.ts" },
				line: 5,
				beforeLine: 2,
				symbol: "calculateCost",
				prefix: "src/",
			}),
		);
		expect(result).toMatchObject({
			kind: "evidence",
			status: "complete",
			gaps: [],
			head: {
				enclosure: "function",
				selection: { startLine: 3, endLine: 7 },
				page: {
					source: head.source,
					content:
						"export function calculateCost(input: number): number {\n  // A brace in a comment: }\n  if (guard(input)) return 0;\n  return input;\n}\n",
				},
			},
			before: {
				enclosure: "function",
				selection: { startLine: 1, endLine: 3 },
				page: { source: before.source },
			},
			lexicalOccurrences: { status: "complete" },
		});
		if (result.localRelationships.kind !== "page") throw new Error("Expected related files");
		expect(result.localRelationships.entries.map((item) => item.path)).toEqual([
			"src/guard.ts",
			"src/cost.test.ts",
		]);
	});

	it("does not cache the mutable investigation manifest", async () => {
		const { catalog } = createCatalog([]);
		const source = {
			...document("head", "mcp/new-evidence", "calculateCost").source,
			role: "investigation" as const,
		};
		vi.spyOn(catalog, "search")
			.mockResolvedValueOnce({
				kind: "page",
				matches: [],
				scannedSources: 0,
				totalSources: 0,
				unavailable: [],
				nextCursor: null,
			})
			.mockResolvedValueOnce({
				kind: "page",
				matches: [{ source, line: 1, column: 0, length: 13 }],
				scannedSources: 1,
				totalSources: 1,
				unavailable: [],
				nextCursor: null,
			});
		const request = { ...SEARCH, role: "investigation" as const, prefix: "" };
		expect(await executeSearch(catalog, request)).toMatchObject({
			status: "complete",
			matches: [],
		});
		expect(await executeSearch(catalog, request)).toMatchObject({
			status: "complete",
			matches: [{ source, line: 1 }],
		});
	});

	it("returns supporting source contents and all remaining exact references at the response batch boundary", async () => {
		const head = document(
			"head",
			"src/cost.ts",
			"export function calculateCost(input: number): number {\n return input;\n}",
		);
		const consumers = Array.from({ length: 6 }, (_, index) =>
			document("head", `src/consumer-${index}.ts`, "calculateCost(5)"),
		);
		const { catalog } = createCatalog([head, ...consumers]);
		const result = await Effect.runPromise(
			reviewEvidenceRetrieval(catalog).evidence({
				source: { role: "head", path: "src/cost.ts" },
				line: 2,
				beforeLine: null,
				symbol: "calculateCost",
				prefix: "src/",
			}),
		);
		expect(result.supportingRanges).toHaveLength(4);
		expect(
			result.supportingRanges.map((item) =>
				item.range.page.kind === "loaded" ? item.range.page.content : null,
			),
		).toEqual(["calculateCost(5)", "calculateCost(5)", "calculateCost(5)", "calculateCost(5)"]);
		expect(result.pendingSources.map((item) => item.source)).toEqual(
			consumers.slice(4).map((item) => item.source),
		);
		expect(result.gaps).toContain("supporting_sources_pending");
		expect(result.supportingRanges.map((item) => item.relationship)).toEqual([
			"lexical_occurrence",
			"lexical_occurrence",
			"lexical_occurrence",
			"lexical_occurrence",
		]);
	});

	it("deduplicates catalog entries with unknown hashes against exact lexical matches and upgrades their identity", async () => {
		const head = document(
			"head",
			"src/cost.ts",
			'import { calculateCostGuard } from "./guard.js";\nexport function calculateCost(input: number): number {\n return calculateCostGuard(input);\n}',
		);
		const guard = document(
			"head",
			"src/guard.ts",
			"export const calculateCostGuard = (input: number) => input;",
		);
		const { catalog } = createCatalog([head, guard]);
		const originalRelated = catalog.related.bind(catalog);
		vi.spyOn(catalog, "related").mockImplementation(async (request, activeSignal) => {
			const result = await originalRelated(request, activeSignal);
			return result.kind === "page"
				? {
						...result,
						entries: result.entries.map((entry) => ({ ...entry, contentHash: null })),
					}
				: result;
		});
		const read = vi.spyOn(catalog, "read");
		const result = await Effect.runPromise(
			reviewEvidenceRetrieval(catalog).evidence({
				source: { role: "head", path: "src/cost.ts" },
				line: 3,
				beforeLine: null,
				symbol: "calculateCost",
				prefix: "src/",
			}),
		);
		expect(result.supportingRanges).toHaveLength(1);
		expect(result.supportingRanges[0]).toMatchObject({
			source: guard.source,
			line: 1,
			column: 13,
			length: 13,
			relationship: "local_import_or_test",
		});
		expect(
			read.mock.calls.filter(([request]) => request.source.path === "src/guard.ts"),
		).toHaveLength(1);
		expect(result.pendingSources).toEqual([]);
	});

	it.each([
		{ content: `const text = "${"x".repeat(5000)}"; calculateCost(5);`, line: 1 },
		{ content: `const text = "${"x".repeat(5000)}";\ncalculateCost(5);`, line: 2 },
	])(
		"marks a supporting target on line $line as undelivered when transport stops before it",
		async ({ content, line }) => {
			const head = document(
				"head",
				"src/cost.ts",
				"export function calculateCost(): number {\n return 1;\n}",
			);
			const caller = document("head", "src/caller.ts", content);
			const { catalog } = createCatalog([head, caller]);
			const result = await Effect.runPromise(
				reviewEvidenceRetrieval(catalog).evidence({
					source: { role: "head", path: "src/cost.ts" },
					line: 2,
					beforeLine: null,
					symbol: "calculateCost",
					prefix: "src/",
				}),
			);
			expect(result.status).toBe("partial");
			expect(result.gaps).toContain("supporting_range_needs_continuation");
			expect(result.gaps).toContain("supporting_target_not_delivered");
			const supporting = result.supportingRanges[0];
			if (supporting === undefined || supporting.range.page.kind !== "loaded")
				throw new Error("Expected supporting range");
			expect(supporting.line).toBe(line);
			expect(supporting.range.page.content).not.toContain("calculateCost");
			let reconstructed = supporting.range.page.content;
			let range = supporting.range.page.nextRange;
			while (range !== null) {
				const next = await catalog.read({ source: supporting.source, range }, signal);
				if (next.kind !== "loaded") throw new Error("Expected continued original");
				reconstructed += next.content;
				range = next.nextRange;
			}
			expect(reconstructed).toBe(content);
		},
	);

	it("marks a long single-line function as partial when its exact selected range needs columns", async () => {
		const content = `export function calculateCost(): string { return "${"x".repeat(5000)}"; }`;
		const { catalog } = createCatalog([document("head", "src/cost.ts", content)]);
		const result = await Effect.runPromise(
			reviewEvidenceRetrieval(catalog).evidence({
				source: { role: "head", path: "src/cost.ts" },
				line: 1,
				beforeLine: null,
				symbol: null,
				prefix: "src/",
			}),
		);
		expect(result.head).toMatchObject({
			enclosure: "function",
			selection: { startLine: 1, endLine: 1, endColumn: content.length },
			page: {
				endLine: 1,
				endColumn: 4096,
				nextRange: { kind: "columns", line: 1, startColumn: 4096 },
			},
		});
		expect(result.gaps).toContain("head_function_needs_continuation");
		if (result.head.page.kind !== "loaded") throw new Error("Expected a source page");
		const continuation = await catalog.read(
			{ source: result.head.page.source, range: result.head.page.nextRange! },
			signal,
		);
		if (continuation.kind !== "loaded") throw new Error("Expected continuation");
		expect(result.head.page.content + continuation.content).toBe(content);
	});

	it.each([
		{ prefix: "", newline: "\n", enclosure: "function", endColumn: 2 },
		{ prefix: "", newline: "\r\n", enclosure: "function", endColumn: 3 },
		{ prefix: "\uFEFF", newline: "\r\n", enclosure: "file_window", endColumn: 18 },
	])(
		"preserves exact selected line terminators and continuation for $enclosure with $newline",
		async ({ prefix, newline, enclosure, endColumn }) => {
			const functionContent = `${prefix}export function calculateCost(): number {${newline} return 1;${newline}}${newline}`;
			const content = functionContent + `const after = 2;${newline}`;
			const { catalog } = createCatalog([document("head", "src/cost.ts", content)]);
			const result = await Effect.runPromise(
				reviewEvidenceRetrieval(catalog).evidence({
					source: { role: "head", path: "src/cost.ts" },
					line: 2,
					beforeLine: null,
					symbol: null,
					prefix: "src/",
				}),
			);
			expect(result.head.enclosure).toBe(enclosure);
			if (result.head.page.kind !== "loaded") throw new Error("Expected loaded source");
			let reconstructed = result.head.page.content;
			if (result.head.page.nextRange !== null) {
				const rest = await catalog.read(
					{ source: result.head.page.source, range: result.head.page.nextRange },
					signal,
				);
				if (rest.kind !== "loaded") throw new Error("Expected continuation");
				reconstructed += rest.content;
			}
			expect(Buffer.from(reconstructed)).toEqual(Buffer.from(content));
			expect(result.head.selection?.endColumn).toBe(endColumn);
		},
	);

	it("retains exact originals and explicit continuation when enclosure is ambiguous or transport fills", async () => {
		const content =
			"export const calculateCost = (input: number) => `${input}`;\n" +
			"// context\n".repeat(400);
		const { catalog } = createCatalog([document("head", "src/cost.ts", content)]);
		const result = await Effect.runPromise(
			reviewEvidenceRetrieval(catalog).evidence({
				source: { role: "head", path: "src/cost.ts" },
				line: 1,
				beforeLine: null,
				symbol: null,
				prefix: "src/",
			}),
		);
		expect(result).toMatchObject({
			status: "partial",
			head: {
				enclosure: "file_window",
				page: { nextRange: { kind: "lines", startLine: 201 } },
			},
		});
		expect(result.gaps).toContain("head_function_enclosure_unverified");
		if (result.head.page.kind !== "loaded") throw new Error("Expected source range");
		const remaining = await catalog.read(
			{ source: result.head.page.source, range: result.head.page.nextRange! },
			signal,
		);
		expect(remaining).toMatchObject({ kind: "loaded", startLine: 201 });
	});
});
