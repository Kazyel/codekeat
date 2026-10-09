import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	readReviewSourceRange,
	type ReviewInput,
	type ReviewInputChunk,
	type ReviewSourceCatalog,
	type ReviewSourceDocument,
} from "#features/review";
import { prepareReviewEvidence } from "../src/integrations/gemini/utils/review-initial-evidence.util.js";

const HEAD = "a".repeat(40);
const BEFORE = "b".repeat(40);
const PATH = "src/cost.ts";
const CONTENT = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n");

function document(role: "head" | "before", path: string, content = CONTENT): ReviewSourceDocument {
	return {
		content,
		source: {
			role,
			path,
			revision: role === "head" ? HEAD : BEFORE,
			repositoryFullName: "takeat/example",
			contentHash: null,
		},
	};
}

function fixtureCatalog(documents: readonly ReviewSourceDocument[]) {
	const read = vi.fn<ReviewSourceCatalog["read"]>(async ({ source, range }) => {
		const found = documents.find(
			(entry) => entry.source.path === source.path && entry.source.role === source.role,
		);
		return found === undefined
			? { kind: "missing", source }
			: readReviewSourceRange(found, range);
	});
	const search = vi.fn<ReviewSourceCatalog["search"]>(async () => ({
		kind: "page",
		matches: [],
		scannedSources: 0,
		totalSources: 0,
		nextCursor: null,
		unavailable: [],
	}));
	const sources: ReviewSourceCatalog = {
		revisions: [document("head", PATH).source, document("before", PATH).source],
		read,
		search,
		list: async () => ({ kind: "page", entries: [], totalEntries: 0, nextCursor: null }),
		related: async () => ({ kind: "page", entries: [], totalEntries: 0, nextCursor: null }),
		recordInvestigation: async () => {
			throw new Error("Preparation should not archive model transcripts");
		},
	};
	return { sources, read, search };
}

function inputFor(
	chunk: ReviewInputChunk,
	files: ReviewInput["repositoryContext"]["files"] = [],
): ReviewInput {
	return {
		baseSha: "c".repeat(40),
		headSha: HEAD,
		body: "Preserve billing behavior",
		title: "Accounting update",
		chunks: [chunk],
		githubInstallationAccountLogin: "takeat",
		pullRequestNumber: 1,
		repositoryFullName: "takeat/example",
		reviewRunId: "run",
		repositoryContext: {
			repositoryFullName: "takeat/example",
			revision: HEAD,
			files,
			omittedFileCount: 0,
		},
	};
}

function chunkFor(diff: string, path = PATH, line = 1): ReviewInputChunk {
	return {
		diff,
		changedLines: new Map([[path, new Set([line])]]),
		referenceBefore: "",
		referenceAfter: "",
		index: 1,
		total: 1,
	};
}

function diffFor(hunk: string, from = PATH, to = PATH): string {
	return `diff --git a/${from} b/${to}\n--- ${from === "/dev/null" ? from : `a/${from}`}\n+++ ${to === "/dev/null" ? to : `b/${to}`}\n${hunk}`;
}

describe("initial evidence preparation", () => {
	it.each([
		{
			name: "replacement with different head and before offsets",
			hunk: "@@ -20,3 +40,4 @@\n context\n-old\n+new\n+another\n tail\n",
			from: PATH,
			to: PATH,
			line: 41,
			beforeLine: 21,
			beforeGap: null,
		},
		{
			name: "insertion anchored to preceding verified context",
			hunk: "@@ -70,2 +75,3 @@\n context\n+new\n tail\n",
			from: PATH,
			to: PATH,
			line: 76,
			beforeLine: 70,
			beforeGap: null,
		},
		{
			name: "insertion anchored to following verified context",
			hunk: "@@ -20,1 +25,2 @@\n+new\n context\n",
			from: PATH,
			to: PATH,
			line: 25,
			beforeLine: 20,
			beforeGap: null,
		},
		{
			name: "new file without an invented before position",
			hunk: "@@ -0,0 +1,2 @@\n+new\n+another\n",
			from: "/dev/null",
			to: PATH,
			line: 1,
			beforeLine: null,
			beforeGap: "before_position_not_provided",
		},
		{
			name: "rename leaves the original path available for directed retrieval",
			hunk: "@@ -1,1 +1,1 @@\n-old\n+new\n",
			from: "src/old-cost.ts",
			to: PATH,
			line: 1,
			beforeLine: null,
			beforeGap: "before_path_changed",
		},
		{
			name: "deleted file reads before while preserving missing head",
			hunk: "@@ -1,2 +0,0 @@\n-old\n-another\n",
			from: PATH,
			to: "/dev/null",
			line: 1,
			beforeLine: 1,
			beforeGap: "head_source_missing",
		},
		{
			name: "malformed hunk keeps its head anchor but cannot prove an old position",
			hunk: "@@ -1,2 +1,3 @@\n-old\n+new\n",
			from: PATH,
			to: PATH,
			line: 1,
			beforeLine: null,
			beforeGap: "before_position_not_provided",
		},
		{
			name: "newline markers do not create duplicate positions",
			hunk: "@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
			from: PATH,
			to: PATH,
			line: 1,
			beforeLine: 1,
			beforeGap: null,
		},
		{
			name: "split insertion window keeps absolute coordinates without inventing old context",
			hunk: "@@ -40,0 +45,1 @@\n+new\n",
			from: PATH,
			to: PATH,
			line: 45,
			beforeLine: null,
			beforeGap: "before_position_not_provided",
		},
	])("prepares $name", async ({ hunk, from, to, line, beforeLine, beforeGap }) => {
		const chunk = chunkFor(diffFor(hunk, from, to), PATH, line);
		const docs = [
			document("before", from === "/dev/null" ? PATH : from),
			...(to === "/dev/null" ? [] : [document("head", PATH)]),
		];
		const { sources } = fixtureCatalog(docs);
		const [prepared] = await Effect.runPromise(
			prepareReviewEvidence(inputFor(chunk), chunk, sources),
		);
		expect(prepared?.request).toEqual({
			source: { role: "head", path: PATH },
			line,
			beforeLine,
			symbol: null,
			prefix: "src/",
		});
		const before = prepared?.result.before?.page;
		expect(before?.kind).toBe(beforeLine === null ? undefined : "loaded");
		expect(before?.kind === "loaded" ? before.source.revision : null).toBe(
			beforeLine === null ? null : BEFORE,
		);
		expect(prepared?.result.head.page).toMatchObject(
			to === "/dev/null"
				? { kind: "missing" }
				: { kind: "loaded", source: { revision: HEAD } },
		);
		expect(prepared?.result.gaps).toEqual(
			expect.arrayContaining([
				"symbol_not_provided",
				...(beforeGap === null ? [] : [beforeGap]),
			]),
		);
	});

	it("preserves every hunk and falls back to the first known changed line when a diff path is unavailable", async () => {
		const chunk: ReviewInputChunk = {
			...chunkFor(diffFor("@@ -1,1 +1,1 @@\n-old\n+new\n@@ -8,1 +12,1 @@\n-old\n+new\n")),
			changedLines: new Map([
				[PATH, new Set([1, 12])],
				["src/unparsed.ts", new Set([9, 3])],
			]),
		};
		const { sources } = fixtureCatalog([document("head", PATH), document("before", PATH)]);
		const prepared = await Effect.runPromise(
			prepareReviewEvidence(inputFor(chunk), chunk, sources),
		);
		expect(
			prepared.map(({ request }) => [request.source.path, request.line, request.beforeLine]),
		).toEqual([
			[PATH, 1, 1],
			[PATH, 12, 8],
			["src/unparsed.ts", 3, null],
		]);
		expect(prepared[2]?.result.gaps).toEqual(
			expect.arrayContaining(["head_source_missing", "before_position_not_provided"]),
		);
	});

	it.each([
		{
			content: "export function calculateCost() {\n return 1;\n}\n",
			revision: HEAD,
			path: PATH,
			symbol: "calculateCost",
		},
		{
			content: "const calculateCost = () => {\n return 1;\n};\n",
			revision: HEAD,
			path: PATH,
			symbol: null,
		},
		{
			content: "export function staleCost() {\n return 1;\n}\n",
			revision: BEFORE,
			path: PATH,
			symbol: null,
		},
		{
			content: "function example() {\n return 1;\n}\n",
			revision: HEAD,
			path: "README.md",
			symbol: null,
		},
	])(
		"uses only a confirmed enclosing inline function as a lexical search hint ($symbol)",
		async ({ content, revision, path, symbol }) => {
			const chunk = chunkFor(diffFor("@@ -2,1 +2,1 @@\n-old\n+new\n", path, path), path, 2);
			const original = inputFor(chunk, [{ kind: "loaded", path, content }]);
			const input = {
				...original,
				repositoryContext: { ...original.repositoryContext, revision },
			};
			const { sources, search } = fixtureCatalog([
				document("head", path, content),
				document("before", path, content),
			]);
			const [prepared] = await Effect.runPromise(
				prepareReviewEvidence(input, chunk, sources),
			);
			expect(prepared?.request.symbol).toBe(symbol);
			expect(prepared?.request.prefix).toBe(path === PATH ? "src/" : "");
			expect([...new Set(search.mock.calls.map(([request]) => request.query))]).toEqual(
				symbol === null ? [] : [symbol],
			);
		},
	);

	it("limits preparation to four concurrent anchors and propagates cancellation to their reads", async () => {
		const paths = Array.from({ length: 7 }, (_, index) => `src/file-${index}.ts`);
		const chunk: ReviewInputChunk = {
			...chunkFor("unparsed diff"),
			changedLines: new Map(paths.map((path) => [path, new Set([1])])),
		};
		const { sources } = fixtureCatalog([]);
		const signals: AbortSignal[] = [];
		let started!: () => void;
		const fourStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const blocked: ReviewSourceCatalog = {
			...sources,
			read: async ({ source }, signal) => {
				signals.push(signal);
				if (signals.length === 4) started();
				return new Promise((resolve) => {
					signal.addEventListener(
						"abort",
						() => resolve({ kind: "unavailable", source, reason: "request_failed" }),
						{ once: true },
					);
				});
			},
		};
		const controller = new AbortController();
		const running = Effect.runPromise(prepareReviewEvidence(inputFor(chunk), chunk, blocked), {
			signal: controller.signal,
		});
		const settled = running.then(
			() => "resolved",
			() => "cancelled",
		);
		await fourStarted;
		expect(signals).toHaveLength(4);
		controller.abort();
		expect(await settled).toBe("cancelled");
		expect(signals).toHaveLength(4);
		expect(signals.every((signal) => signal.aborted)).toBe(true);
	});
});
