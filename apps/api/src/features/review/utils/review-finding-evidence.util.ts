import parseDiff, { type Chunk, type File } from "parse-diff";

import type {
	ReviewFindingCandidate,
	ReviewFindingEvidence,
	ReviewFindingJudgeInput,
	ReviewInputChunk,
} from "../types/review-input.types.js";
import type { ReviewFinding } from "../types/review-run.types.js";

export const MAXIMUM_JUDGE_BATCH_EVIDENCE_LENGTH = 80_000;
export const MAXIMUM_JUDGE_BATCH_FINDINGS = 50;

export interface ChunkFindingCandidate {
	readonly chunk: ReviewInputChunk;
	readonly finding: ReviewFinding;
}

export interface ReviewFindingJudgeBatch {
	readonly input: ReviewFindingJudgeInput;
	readonly findings: readonly ReviewFinding[];
}

interface CandidateEvidence {
	readonly evidence: ReviewFindingEvidence;
	readonly finding: ReviewFinding;
}

export function createReviewFindingJudgeBatches(
	candidates: readonly ChunkFindingCandidate[],
): readonly ReviewFindingJudgeBatch[] | null {
	const entries: CandidateEvidence[] = [];
	const parsedFilesByChunk = new Map<number, readonly File[]>();
	for (const candidate of candidates) {
		let files = parsedFilesByChunk.get(candidate.chunk.index);
		if (files === undefined) {
			files = parseDiff(candidate.chunk.diff);
			parsedFilesByChunk.set(candidate.chunk.index, files);
		}
		const evidence = findReviewFindingEvidence(candidate.chunk, candidate.finding, files);
		if (evidence === null) {
			return null;
		}
		entries.push({ evidence, finding: candidate.finding });
	}
	return packCandidateEvidence(entries);
}

export function extractReviewFindingEvidence(
	chunk: ReviewInputChunk,
	finding: ReviewFinding,
): ReviewFindingEvidence | null {
	return findReviewFindingEvidence(chunk, finding, parseDiff(chunk.diff));
}

function findReviewFindingEvidence(
	chunk: ReviewInputChunk,
	finding: ReviewFinding,
	files: readonly File[],
): ReviewFindingEvidence | null {
	for (const [fileIndex, file] of files.entries()) {
		if (!fileMatchesPath(file, finding.path)) {
			continue;
		}
		const hunkIndex = file.chunks.findIndex((hunk) => hunkContainsLine(hunk, finding.line));
		if (hunkIndex !== -1) {
			return {
				id: `chunk-${chunk.index}-file-${fileIndex}-hunk-${hunkIndex}`,
				diff: serializeHunk(file, file.chunks[hunkIndex]!),
				referenceBefore: chunk.referenceBefore,
				referenceAfter: chunk.referenceAfter,
			};
		}
	}
	return null;
}

function packCandidateEvidence(
	entries: readonly CandidateEvidence[],
): readonly ReviewFindingJudgeBatch[] {
	const batches: ReviewFindingJudgeBatch[] = [];
	let current: CandidateEvidence[] = [];

	for (const entry of entries) {
		if (current.length > 0 && wouldExceedBatch(current, entry)) {
			batches.push(toJudgeBatch(current));
			current = [];
		}
		current.push(entry);
	}
	if (current.length > 0) {
		batches.push(toJudgeBatch(current));
	}
	return batches;
}

function wouldExceedBatch(current: readonly CandidateEvidence[], next: CandidateEvidence): boolean {
	if (current.length >= MAXIMUM_JUDGE_BATCH_FINDINGS) {
		return true;
	}
	const evidenceById = new Map(current.map((entry) => [entry.evidence.id, entry.evidence]));
	evidenceById.set(next.evidence.id, next.evidence);
	return evidenceLength([...evidenceById.values()]) > MAXIMUM_JUDGE_BATCH_EVIDENCE_LENGTH;
}

function toJudgeBatch(entries: readonly CandidateEvidence[]): ReviewFindingJudgeBatch {
	const evidenceById = new Map(entries.map((entry) => [entry.evidence.id, entry.evidence]));
	const candidates: ReviewFindingCandidate[] = entries.map((entry, index) => ({
		index,
		evidenceId: entry.evidence.id,
		finding: entry.finding,
	}));
	return {
		input: { candidates, evidence: [...evidenceById.values()] },
		findings: entries.map((entry) => entry.finding),
	};
}

function evidenceLength(evidence: readonly ReviewFindingEvidence[]): number {
	return evidence.reduce(
		(total, item) =>
			total + item.diff.length + item.referenceBefore.length + item.referenceAfter.length,
		0,
	);
}

function fileMatchesPath(file: File, path: string): boolean {
	return file.to === path || file.from === path;
}

function hunkContainsLine(hunk: Chunk, line: number): boolean {
	return hunk.changes.some((change) => change.type === "add" && change.ln === line);
}

function serializeHunk(file: File, hunk: Chunk): string {
	const from = file.from ?? "/dev/null";
	const to = file.to ?? "/dev/null";
	const fromHeader = from === "/dev/null" ? from : `a/${from}`;
	const toHeader = to === "/dev/null" ? to : `b/${to}`;
	return [
		`diff --git a/${from} b/${to}`,
		`--- ${fromHeader}`,
		`+++ ${toHeader}`,
		hunk.content,
		...hunk.changes.map((change) => change.content),
		"",
	].join("\n");
}
