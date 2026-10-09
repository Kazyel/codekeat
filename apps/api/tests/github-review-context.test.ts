import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import type { ReviewInputChunk } from "#features/review";
import {
	loadGitHubReviewContext,
	type GitHubReviewContentLocation,
} from "../src/features/github/services/github-review-context.service.js";

describe("GitHub review context I/O", () => {
	it("reads complete sources concurrently with stable ordering and deduplicates shared imports and directories", async () => {
		const paths = Array.from({ length: 8 }, (_, index) => `src/file-${index}.ts`);
		const source = new RecordedContextSource(
			new Map([
				[
					".codekeat",
					[
						directoryEntry(".codekeat/slow", "dir"),
						directoryEntry(".codekeat/fast", "dir"),
					],
				],
				[".codekeat/slow", [directoryEntry(".codekeat/slow/a.md", "file")]],
				[".codekeat/fast", [directoryEntry(".codekeat/fast/b.md", "file")]],
				[".codekeat/README.md", githubTextFile("Project map")],
				[".codekeat/slow/a.md", githubTextFile("First discovered document")],
				[".codekeat/fast/b.md", githubTextFile("Second discovered document")],
				...paths
					.slice(0, 4)
					.map(
						(path) =>
							[
								path,
								githubTextFile(`import './shared.js';\ncomplete-${path}`),
							] as const,
					),
				[paths[4]!, { type: "file", encoding: "none", content: "", size: 15 }],
				[`${paths[4]}:raw`, "full raw source"],
				[paths[6]!, { type: "symlink", target: "shared.ts" }],
				[paths[7]!, Object.assign(new Error("Forbidden"), { status: 403 })],
				[
					"src",
					[
						directoryEntry("src/shared.ts", "file"),
						directoryEntry("src/file-0.test.ts", "file"),
					],
				],
				["src/shared.ts", githubTextFile("Shared contract")],
				["src/file-0.test.ts", githubTextFile("Caller behavior test")],
				["tests", Object.assign(new Error("Forbidden"), { status: 403 })],
			]),
			new Map([
				[".codekeat/slow", 8],
				[paths[0]!, 8],
			]),
		);

		const result = await loadGitHubReviewContext(source, "contributor/codekeat", "head-sha", [
			chunk(paths),
		]);

		expect(result.files).toEqual([
			{ kind: "loaded", path: ".codekeat/README.md", content: "Project map" },
			{ kind: "missing", path: ".codekeat/domain.md" },
			{ kind: "missing", path: ".codekeat/integrations.md" },
			{ kind: "loaded", path: ".codekeat/slow/a.md", content: "First discovered document" },
			{ kind: "loaded", path: ".codekeat/fast/b.md", content: "Second discovered document" },
			...paths.slice(0, 4).map((path) => ({
				kind: "loaded",
				path,
				content: `import './shared.js';\ncomplete-${path}`,
			})),
			{ kind: "loaded", path: paths[4], content: "full raw source" },
			{ kind: "missing", path: paths[5] },
			{ kind: "unavailable", path: paths[6], reason: "invalid_response" },
			{ kind: "unavailable", path: paths[7], reason: "request_failed" },
			{ kind: "loaded", path: "src/shared.ts", content: "Shared contract" },
			{ kind: "loaded", path: "src/file-0.test.ts", content: "Caller behavior test" },
			{ kind: "unavailable", path: "tests", reason: "request_failed" },
		]);
		expect(result.omittedFileCount).toBe(0);
		expect(source.peak).toBe(4);
		for (const path of ["src", "tests", "src/shared.ts", "src/file-0.test.ts", ...paths])
			expect(
				source.requests.filter(
					(request) => request.path === path && request.headers === undefined,
				),
			).toHaveLength(1);
		expect(
			source.requests.filter(
				(request) => request.headers?.accept === "application/vnd.github.raw+json",
			),
		).toHaveLength(1);
		expect(
			source.requests.every(
				(request) =>
					request.owner === "contributor" &&
					request.repo === "codekeat" &&
					request.ref === "head-sha",
			),
		).toBe(true);
	});

	it("does not reuse authorization-dependent content across invocations", async () => {
		const responses = new Map<string, unknown>([
			[".codekeat", []],
			["file.txt", githubTextFile("Authorized content")],
		]);
		const source = new RecordedContextSource(responses);
		const first = await loadGitHubReviewContext(source, "takeat/codekeat", "head-sha", [
			chunk(["file.txt"]),
		]);
		expect(first.files).toContainEqual({
			kind: "loaded",
			path: "file.txt",
			content: "Authorized content",
		});
		responses.set("file.txt", Object.assign(new Error("Forbidden"), { status: 403 }));

		const second = await loadGitHubReviewContext(source, "takeat/codekeat", "head-sha", [
			chunk(["file.txt"]),
		]);

		expect(second.files).toContainEqual({
			kind: "unavailable",
			path: "file.txt",
			reason: "request_failed",
		});
		expect(source.requests.filter((request) => request.path === "file.txt")).toHaveLength(2);
	});

	it("caps HTTP requests across simultaneous invocations without sharing their source caches", async () => {
		const paths = Array.from({ length: 8 }, (_, index) => `file-${index}.txt`);
		const source = new RecordedContextSource(
			new Map<string, unknown>([
				[".codekeat", []],
				...paths.map((path) => [path, githubTextFile(path)] as const),
			]),
		);

		const results = await Promise.all(
			Array.from({ length: 6 }, (_, index) =>
				loadGitHubReviewContext(source, `contributor/repo-${index}`, "head-sha", [
					chunk(paths),
				]),
			),
		);

		expect(source.peak).toBe(16);
		expect([...source.peaksByRepository.values()]).toEqual(Array(6).fill(4));
		for (const result of results)
			expect(
				result.files.filter((file) => file.kind === "loaded").map((file) => file.path),
			).toEqual(paths);
		for (const path of paths)
			expect(source.requests.filter((request) => request.path === path)).toHaveLength(6);
	});

	it("aborts active I/O and discards queued reads when the invocation is cancelled", async () => {
		const controller = new AbortController();
		const ready = Promise.withResolvers<void>();
		const signals: AbortSignal[] = [];
		const source = {
			async getContent(
				location: GitHubReviewContentLocation,
			): Promise<{ readonly data: unknown }> {
				if (location.path === ".codekeat") return { data: [] };
				if (location.path.startsWith(".codekeat/"))
					throw Object.assign(new Error("Not found"), { status: 404 });
				const signal = location.request?.signal;
				if (signal === undefined) throw new Error("Expected an I/O cancellation signal");
				signals.push(signal);
				if (signals.length === 4) ready.resolve();
				await setTimeout(10_000, undefined, { signal });
				throw new Error("The cancelled read must not complete");
			},
		};
		const pending = loadGitHubReviewContext(
			source,
			"takeat/codekeat",
			"head-sha",
			[chunk(Array.from({ length: 20 }, (_, index) => `file-${index}.txt`))],
			controller.signal,
		);
		const abort = ready.promise.then(() => controller.abort());
		await expect(pending).rejects.toBeInstanceOf(Error);
		await abort;
		expect(signals).toHaveLength(4);
		expect(signals.every((signal) => signal.aborted)).toBe(true);
	});
});

class RecordedContextSource {
	readonly requests: GitHubReviewContentLocation[] = [];
	readonly peaksByRepository = new Map<string, number>();
	private readonly activeByRepository = new Map<string, number>();
	private active = 0;
	peak = 0;

	constructor(
		private readonly responses: ReadonlyMap<string, unknown>,
		private readonly delays: ReadonlyMap<string, number> = new Map(),
	) {}

	async getContent(location: GitHubReviewContentLocation): Promise<{ readonly data: unknown }> {
		this.requests.push(location);
		this.active++;
		this.peak = Math.max(this.peak, this.active);
		const active = (this.activeByRepository.get(location.repo) ?? 0) + 1;
		this.activeByRepository.set(location.repo, active);
		this.peaksByRepository.set(
			location.repo,
			Math.max(this.peaksByRepository.get(location.repo) ?? 0, active),
		);
		try {
			await setTimeout(this.delays.get(location.path) ?? 1, undefined, {
				signal: location.request?.signal,
			});
			const key = location.headers === undefined ? location.path : `${location.path}:raw`;
			if (!this.responses.has(key))
				throw Object.assign(new Error("Not found"), { status: 404 });
			const data = this.responses.get(key);
			if (data instanceof Error) throw data;
			return { data };
		} finally {
			this.active--;
			this.activeByRepository.set(
				location.repo,
				(this.activeByRepository.get(location.repo) ?? 1) - 1,
			);
		}
	}
}

function chunk(paths: readonly string[]): ReviewInputChunk {
	return {
		changedLines: new Map(paths.map((path) => [path, new Set([1])])),
		diff: "",
		referenceBefore: "",
		referenceAfter: "",
		index: 1,
		total: 1,
	};
}

function directoryEntry(
	path: string,
	type: "file" | "dir",
): { readonly path: string; readonly name: string; readonly type: "file" | "dir" } {
	return { path, name: path.split("/").at(-1)!, type };
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
