import { createHash } from "node:crypto";
import { posix } from "node:path";
import parseDiff from "parse-diff";
import type { ReviewInput, ReviewInputChunk } from "../types/review-input.types.js";
import { decodeGitDiffPath } from "./review-source-paths.util.js";

/** An estimate packs work; the provider's count of the complete request is authoritative. */
export function planReviewChunks(
	input: ReviewInput,
	inputTokenLimit: number,
): readonly ReviewInputChunk[] {
	const targetBytes = Math.max(1, Math.floor(inputTokenLimit * 0.4));
	const packets: ReviewInputChunk[] = [];
	let current: ReviewInputChunk[] = [];
	for (const chunk of input.chunks) {
		if (!canPack(current, chunk, targetBytes)) {
			packets.push(combineChunks(current));
			current = [];
		}
		current.push(chunk);
	}
	if (current.length > 0) packets.push(combineChunks(current));
	return packets.map((chunk, index) => ({ ...chunk, index: index + 1, total: packets.length }));
}
export function reviewPlanFingerprint(
	input: ReviewInput,
	modelName: string,
	strategy: string,
): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				base: input.baseSha,
				head: input.headSha,
				repository: input.repositoryFullName,
				title: input.title,
				body: input.body,
				diffs: input.chunks.map((chunk) => chunk.diff),
				context: input.repositoryContext,
				modelName,
				strategy,
			}),
		)
		.digest("hex");
}
export function splitReviewChunk(chunk: ReviewInputChunk): readonly ReviewInputChunk[] | null {
	const blocks = chunk.diff.split(/(?=^diff --git )/m).filter(Boolean);
	if (blocks.length > 1) return splitBlocks(chunk, blocks);
	const pieces = splitFileBlock(chunk.diff);
	if (pieces === null) return null;
	return pieces.map((diff) => chunkWithDiff(chunk, diff));
}
export function assertReviewCoverage(
	original: readonly ReviewInputChunk[],
	leaves: readonly ReviewInputChunk[],
): void {
	assertDiffContentCoverage(original, leaves);
	const expected = coverageKeys(original);
	const actual = coverageKeys(leaves);
	if (expected.size !== actual.size || [...expected].some((key) => !actual.has(key)))
		throw new Error("Review work plan has incomplete changed-line coverage.");
	const paths = (chunks: readonly ReviewInputChunk[]) =>
		new Set(chunks.flatMap((chunk) => [...chunk.changedLines.keys()]));
	const expectedPaths = paths(original),
		actualPaths = paths(leaves);
	if (
		expectedPaths.size !== actualPaths.size ||
		[...expectedPaths].some((path) => !actualPaths.has(path))
	)
		throw new Error("Review work plan has incomplete file coverage.");
}
function canPack(
	current: readonly ReviewInputChunk[],
	next: ReviewInputChunk,
	targetBytes: number,
): boolean {
	if (current.length === 0) return true;
	const paths = new Set(current.flatMap((chunk) => [...chunk.changedLines.keys()]));
	const nextPaths = [...next.changedLines.keys()];
	if (nextPaths.some((path) => paths.has(path))) return false;
	const directories = new Set([...paths].map((path) => posix.dirname(path)));
	if (!nextPaths.some((path) => directories.has(posix.dirname(path)))) return false;
	return (
		current.reduce((bytes, chunk) => bytes + Buffer.byteLength(chunk.diff), 0) +
			Buffer.byteLength(next.diff) <=
		targetBytes
	);
}
function combineChunks(chunks: readonly ReviewInputChunk[]): ReviewInputChunk {
	const first = chunks[0];
	if (first === undefined) throw new Error("Cannot create an empty review packet.");
	const changedLines = new Map<string, Set<number>>();
	for (const chunk of chunks)
		for (const [path, lines] of chunk.changedLines)
			changedLines.set(path, new Set([...(changedLines.get(path) ?? []), ...lines]));
	return {
		...first,
		changedLines,
		diff: chunks.map((chunk) => chunk.diff).join(""),
		referenceBefore: chunks.map((chunk) => chunk.referenceBefore).join("\n"),
		referenceAfter: chunks.map((chunk) => chunk.referenceAfter).join("\n"),
	};
}
function splitBlocks(
	chunk: ReviewInputChunk,
	blocks: readonly string[],
): readonly ReviewInputChunk[] {
	const midpoint = Math.ceil(blocks.length / 2);
	return [blocks.slice(0, midpoint).join(""), blocks.slice(midpoint).join("")].map((diff) =>
		chunkWithDiff(chunk, diff),
	);
}
function splitFileBlock(diff: string): readonly string[] | null {
	const firstHunk = diff.search(/^@@ /m);
	if (firstHunk === -1) return null;
	const metadata = diff.slice(0, firstHunk);
	const hunks = diff.slice(firstHunk).split(/(?=^@@ )/m);
	if (hunks.length > 1) {
		const midpoint = Math.ceil(hunks.length / 2);
		return [
			metadata + hunks.slice(0, midpoint).join(""),
			metadata + hunks.slice(midpoint).join(""),
		];
	}
	const windows = splitHunk(hunks[0]!);
	return windows?.map((window) => metadata + window) ?? null;
}
function splitHunk(hunk: string): readonly string[] | null {
	const newline = hunk.indexOf("\n");
	const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(hunk.slice(0, newline));
	if (header === null) return null;
	const lines = hunkLines(hunk.slice(newline + 1));
	const changes = lines.filter((line) => /^[ +-]/.test(line));
	if (changes.length <= 1) return null;
	const boundary = splitBoundary(lines, Math.ceil(changes.length / 2));
	const first = lines.slice(0, boundary),
		second = lines.slice(boundary);
	const oldStart = Number(header[1]),
		newStart = Number(header[3]);
	const oldCount = countSide(first, "+"),
		newCount = countSide(first, "-");
	return [
		hunkWindow(first, oldStart, newStart, headerSuffix(header)),
		hunkWindow(second, oldStart + oldCount, newStart + newCount, headerSuffix(header)),
	];
}
function countSide(lines: readonly string[], excluded: string): number {
	return lines.filter((line) => /^[ +-]/.test(line) && !line.startsWith(excluded)).length;
}
function hunkWindow(
	lines: readonly string[],
	oldStart: number,
	newStart: number,
	suffix: string,
): string {
	return `@@ -${oldStart},${countSide(lines, "+")} +${newStart},${countSide(lines, "-")} @@${suffix}\n${lines.join("")}`;
}
function chunkWithDiff(chunk: ReviewInputChunk, diff: string): ReviewInputChunk {
	const changedLines = new Map<string, Set<number>>();
	for (const file of parseDiff(diff)) {
		const path = file.to === "/dev/null" ? file.from : file.to;
		if (path === undefined) throw new Error("Split review diff has no repository path.");
		changedLines.set(
			decodeGitDiffPath(path),
			new Set(
				file.chunks.flatMap((hunk) =>
					hunk.changes
						.filter((change) => change.type === "add")
						.map((change) => change.ln),
				),
			),
		);
	}
	return { ...chunk, diff, changedLines };
}
function coverageKeys(chunks: readonly ReviewInputChunk[]): ReadonlySet<string> {
	return new Set(
		chunks.flatMap((chunk) =>
			[...chunk.changedLines].flatMap(([path, lines]) =>
				[...lines].map((line) => `${path}:${line}`),
			),
		),
	);
}

function hunkLines(content: string): readonly string[] {
	return content.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
}
function headerSuffix(header: RegExpExecArray): string {
	return header[5] ?? "";
}
function splitBoundary(lines: readonly string[], midpoint: number): number {
	let seen = 0;
	for (const [index, line] of lines.entries()) {
		if (/^[ +-]/.test(line)) seen++;
		if (seen === midpoint) return markerBoundary(lines, index + 1);
	}
	throw new Error("Diff hunk has no complete subdivision.");
}
function markerBoundary(lines: readonly string[], boundary: number): number {
	return lines[boundary]?.startsWith("\\") ? boundary + 1 : boundary;
}

function assertDiffContentCoverage(
	original: readonly ReviewInputChunk[],
	leaves: readonly ReviewInputChunk[],
): void {
	const expected = diffContentInventory(original),
		actual = diffContentInventory(leaves);
	if (
		expected.size !== actual.size ||
		[...expected].some(([key, count]) => actual.get(key) !== count)
	)
		throw new Error("Review work plan changed or omitted diff content.");
}
function diffContentInventory(chunks: readonly ReviewInputChunk[]): ReadonlyMap<string, number> {
	const inventory = new Map<string, number>();
	for (const chunk of chunks)
		for (const file of parseDiff(chunk.diff))
			for (const hunk of file.chunks)
				for (const change of hunk.changes) {
					const key = JSON.stringify([file.from, file.to, change]);
					incrementInventory(inventory, key);
				}
	return inventory;
}

function incrementInventory(inventory: Map<string, number>, key: string): void {
	inventory.set(key, (inventory.get(key) ?? 0) + 1);
}
