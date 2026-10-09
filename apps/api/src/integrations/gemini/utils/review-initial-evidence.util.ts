import { posix } from "node:path";
import parseDiff, { type Change, type Chunk, type File } from "parse-diff";
import { Effect } from "effect";

import {
	decodeGitDiffPath,
	reviewEvidenceRetrieval,
	reviewSourceLineCount,
	readReviewSourceRange,
	selectReviewEvidenceRange,
	type ReviewInput,
	type ReviewInputChunk,
	type ReviewSourceCatalog,
	type ReviewSourceEvidenceRequest,
	type ReviewSourceEvidenceResult,
	type ReviewEvidenceRange,
	type ReviewSourceReadResult,
} from "#features/review";

export interface ReviewPreparedEvidence {
	readonly request: ReviewSourceEvidenceRequest;
	readonly result: ReviewSourceEvidenceResult;
}

interface EvidenceAnchor {
	readonly path: string;
	readonly line: number;
	readonly beforeLine: number | null;
	readonly beforeGap: "before_path_changed" | null;
}

/** Reuses bounded retrieval Effects; incomplete lookups remain evidence gaps, never negative proof. */
export function prepareReviewEvidence(
	input: ReviewInput,
	chunk: ReviewInputChunk,
	sources: ReviewSourceCatalog,
): Effect.Effect<readonly ReviewPreparedEvidence[]> {
	return Effect.suspend(() => {
		const retrieval = reviewEvidenceRetrieval(sources);
		return Effect.forEach(
			evidenceAnchors(chunk),
			(anchor) => {
				const request = evidenceRequest(input, anchor);
				return retrieval.evidence(request).pipe(
					Effect.map((result) => ({
						request,
						result: retainAnchorGap(result, anchor),
					})),
				);
			},
			{ concurrency: 4 },
		);
	});
}

function evidenceAnchors(chunk: ReviewInputChunk): readonly EvidenceAnchor[] {
	const solePath = chunk.changedLines.size === 1 ? [...chunk.changedLines.keys()][0] : undefined;
	const anchors = parseDiff(chunk.diff).flatMap((file) => fileAnchors(file, solePath));
	const covered = new Set(anchors.map((anchor) => anchor.path));
	for (const [path, lines] of chunk.changedLines) {
		if (covered.has(path)) continue;
		const line = [...lines].reduce((first, candidate) => Math.min(first, candidate), Infinity);
		if (positiveLine(line)) anchors.push({ path, line, beforeLine: null, beforeGap: null });
	}
	return anchors;
}

function fileAnchors(file: File, solePath: string | undefined): readonly EvidenceAnchor[] {
	const encoded = file.to === "/dev/null" ? file.from : file.to;
	const path = encoded === undefined ? solePath : decodeGitDiffPath(encoded);
	if (path === undefined) return [];
	const sameBeforePath = beforePathMatches(file, path);
	const beforeGap = renameGap(file, path);
	return file.chunks.flatMap((hunk) => hunkAnchor(path, hunk, sameBeforePath, beforeGap));
}

function beforePathMatches(file: File, path: string): boolean {
	return file.from === undefined || decodeGitDiffPath(file.from) === path;
}

function renameGap(file: File, path: string): EvidenceAnchor["beforeGap"] {
	if (file.from === "/dev/null") return null;
	if (beforePathMatches(file, path)) return null;
	return "before_path_changed";
}

function hunkAnchor(
	path: string,
	hunk: Chunk,
	sameBeforePath: boolean,
	beforeGap: EvidenceAnchor["beforeGap"],
): readonly EvidenceAnchor[] {
	const changes = hunk.changes.filter((change) => !change.content.startsWith("\\"));
	const addition = changes.findIndex((change) => change.type === "add");
	const line = anchorLine(hunk, changes[addition]);
	if (!positiveLine(line)) return [];
	return [
		{
			path,
			line,
			beforeLine: hunkBeforeLine(hunk, changes, sameBeforePath, addition),
			beforeGap,
		},
	];
}

function anchorLine(hunk: Chunk, change: Change | undefined): number {
	if (change?.type === "add") return change.ln;
	return Math.max(1, hunk.newStart);
}

function hunkBeforeLine(
	hunk: Chunk,
	changes: readonly Change[],
	sameBeforePath: boolean,
	addition: number,
): number | null {
	if (!sameBeforePath) return null;
	if (!verifiedHunk(hunk, changes)) return null;
	return beforeAnchor(changes, addition);
}

function verifiedHunk(hunk: Chunk, changes: readonly Change[]): boolean {
	if (changes.filter((change) => change.type !== "add").length !== hunk.oldLines) return false;
	if (changes.filter((change) => change.type !== "del").length !== hunk.newLines) return false;
	const position = { before: hunk.oldStart, head: hunk.newStart };
	return changes.every((change) => verifiedChange(change, position));
}

function verifiedChange(change: Change, position: { before: number; head: number }): boolean {
	const prefix = { normal: " ", add: "+", del: "-" }[change.type];
	if (!change.content.startsWith(prefix)) return false;
	if (change.type === "normal")
		return (
			alignedLine(change.ln1, position.before++) && alignedLine(change.ln2, position.head++)
		);
	const side = change.type === "del" ? "before" : "head";
	return alignedLine(change.ln, position[side]++);
}

function alignedLine(line: number, expected: number): boolean {
	return positiveLine(line) && line === expected;
}

/** An old deleted/context position is an anchor, not an asserted counterpart of an added line. */
function beforeAnchor(changes: readonly Change[], addition: number): number | null {
	const previous = changes.slice(0, addition < 0 ? changes.length : addition);
	const boundary = previous.findLastIndex((change) => change.type === "normal");
	const deletion = previous.slice(boundary + 1).find((change) => change.type === "del");
	if (deletion?.type === "del") return deletion.ln;
	return nearbyBeforeContext(previous[boundary], changes);
}

function nearbyBeforeContext(
	previous: Change | undefined,
	changes: readonly Change[],
): number | null {
	if (previous?.type === "normal") return previous.ln1;
	const next = changes.find((change) => change.type === "normal");
	return next?.type === "normal" ? next.ln1 : null;
}

function retainAnchorGap(
	result: ReviewSourceEvidenceResult,
	anchor: EvidenceAnchor,
): ReviewSourceEvidenceResult {
	if (anchor.beforeGap === null) return result;
	return { ...result, status: "partial", gaps: [...result.gaps, anchor.beforeGap] };
}

function evidenceRequest(input: ReviewInput, anchor: EvidenceAnchor): ReviewSourceEvidenceRequest {
	const directory = posix.dirname(anchor.path);
	return {
		source: { role: "head", path: anchor.path },
		line: anchor.line,
		beforeLine: anchor.beforeLine,
		symbol: inlineFunctionSymbol(input, anchor),
		prefix: directory === "." ? "" : `${directory}/`,
	};
}

function inlineFunctionSymbol(input: ReviewInput, anchor: EvidenceAnchor): string | null {
	if (!/\.[cm]?[jt]sx?$/.test(anchor.path)) return null;
	const page = inlineSourcePage(input, anchor);
	if (page === null) return null;
	return enclosureSymbol(selectReviewEvidenceRange(page, anchor.line));
}

function inlineSourcePage(
	input: ReviewInput,
	anchor: EvidenceAnchor,
): ReviewSourceReadResult | null {
	if (input.repositoryContext.revision !== input.headSha) return null;
	const file = input.repositoryContext.files.find((candidate) => candidate.path === anchor.path);
	if (file?.kind !== "loaded") return null;
	return readReviewSourceRange(
		{
			content: file.content,
			source: {
				role: "head",
				path: file.path,
				revision: input.headSha,
				repositoryFullName: input.repositoryFullName,
				contentHash: null,
			},
		},
		{
			kind: "lines",
			startLine: 1,
			lineCount: Math.max(1, reviewSourceLineCount(file.content)),
		},
	);
}

function enclosureSymbol(enclosure: ReviewEvidenceRange): string | null {
	if (enclosure.enclosure !== "function") return null;
	if (enclosure.page.kind !== "loaded") return null;
	const match = /^(?:\s|export\s+|default\s+|async\s+)*function\s+([\w$]+)\s*\(/.exec(
		enclosure.page.content,
	);
	if (match === null) return null;
	return match[1] ?? null;
}

function positiveLine(line: number): boolean {
	return Number.isSafeInteger(line) && line > 0;
}
