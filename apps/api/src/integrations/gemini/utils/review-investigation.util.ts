import { tool, type ToolSet } from "ai";
import { z } from "zod";
import parseDiff from "parse-diff";
import {
	reviewConclusionSchema,
	ReviewModelResponseError,
	type ReviewConclusion,
	type ReviewInput,
	type ReviewInputChunk,
	type ReviewInvestigation,
	type ReviewModelResult,
	type ReviewFinding,
	type ReviewContextExchange,
	type ReviewSourceRevision,
	decodeGitDiffPath,
} from "#features/review";
import { validateReviewEvidenceProvenance } from "./review-evidence-provenance.util.js";

const nextTool = z.enum([
	"source_evidence",
	"source_read",
	"source_search",
	"source_related",
	"source_list",
	"ecosystem",
]);

/** The model records externally checkable scenarios; the host owns the loop policy. */
export class ReviewInvestigationState {
	private current: ReviewConclusion | null = null;
	private requestedTools: readonly z.infer<typeof nextTool>[] = [];

	constructor(private readonly validateCheckpoint: (conclusion: ReviewConclusion) => void) {}

	tools(): ToolSet {
		return {
			investigation_checkpoint: tool({
				description:
					"Record concrete scenarios, sources and unresolved evidence gaps. Use nextTools for the next retrieval step. Complete means all reportable files and relevant boundary scenarios were checked; coverage alone is not proof of correctness. Inline sources can supply evidence without extra reads.",
				inputSchema: z
					.object({ conclusion: reviewConclusionSchema, nextTools: z.array(nextTool) })
					.strict(),
				execute: async ({ conclusion, nextTools }) => {
					this.validateCheckpoint(conclusion);
					this.current = conclusion;
					this.requestedTools = nextTools;
					return { status: conclusion.status, pendingTools: nextTools };
				},
			}),
		};
	}

	activeTools(available: readonly string[]): readonly string[] {
		if (this.current?.status === "complete") return [];
		if (this.requestedTools.length === 0) return available;
		return available.filter(
			(name) =>
				name === "investigation_checkpoint" || requestedTool(name, this.requestedTools),
		);
	}
}

function requestedTool(name: string, requested: readonly z.infer<typeof nextTool>[]): boolean {
	return (
		requested.some((entry) => entry === name) ||
		(requested.includes("ecosystem") && !name.startsWith("source_"))
	);
}

export function validateReviewConclusion(
	conclusion: ReviewConclusion,
	input: ReviewInput,
	chunk: ReviewInputChunk,
	findings: readonly ReviewFinding[],
	exchanges: readonly ReviewContextExchange[],
	revisions: readonly ReviewSourceRevision[],
): void {
	validateReviewCheckpoint(conclusion, input, chunk, exchanges, revisions);
	const candidates = conclusion.hypotheses.filter((entry) => entry.outcome === "candidate");
	const missingFinding = candidates.some(
		(candidate) => !findings.some((finding) => sameLocation(candidate, finding)),
	);
	const missingCandidate = findings.some(
		(finding) => !candidates.some((candidate) => sameLocation(candidate, finding)),
	);
	if (missingFinding || missingCandidate)
		throw new ReviewModelResponseError("context_response_invalid");
}

function sameLocation(
	left: { readonly path: string; readonly line: number },
	right: { readonly path: string; readonly line: number },
): boolean {
	return left.path === right.path && left.line === right.line;
}

export function validateReviewCheckpoint(
	conclusion: ReviewConclusion,
	input: ReviewInput,
	chunk: ReviewInputChunk,
	exchanges: readonly ReviewContextExchange[],
	revisions: readonly ReviewSourceRevision[],
): void {
	validateReviewEvidenceProvenance(conclusion, input, exchanges, revisions);
	if (conclusion.status !== "complete") return;
	const covered = new Set(conclusion.reviewedPaths);
	const missing = [...chunk.changedLines.keys()].some(
		(path) => !covered.has(path) || !conclusion.hypotheses.some((entry) => entry.path === path),
	);
	if (missing) throw new ReviewModelResponseError("context_response_invalid");
}

const discoveryRisks = [
	{
		matches: (paths: string, added: string): boolean =>
			/\breturn\b/.test(added) &&
			/cost|price|payment|billing|token|amount|balance/i.test(paths),
		reason: "Verify reachable boundary scenarios in changed financial calculations and guards.",
	},
	{
		matches: (paths: string, added: string): boolean =>
			/auth|permission|access|session/i.test(paths) &&
			/\b(if|return|allow|deny)\b/.test(added),
		reason: "Verify changed authorization guards against callers and permitted input states.",
	},
	{
		matches: (_paths: string, added: string): boolean =>
			/\b(transaction|commit|rollback|insert|update|delete)\b/.test(added),
		reason: "Verify changed persistence ordering and failure paths against actual consumers.",
	},
];

export function independentDiscoveryReason(
	chunk: ReviewInputChunk,
	result: ReviewModelResult,
): string | null {
	if (result.findings.length > 0) return null;
	if (
		result.investigation.kind === "verified" &&
		result.investigation.conclusion.status === "incomplete"
	)
		return "Verify unresolved evidence gaps with an independent investigation.";
	return changedFileDiscoveryReason(chunk);
}

function changedFileDiscoveryReason(chunk: ReviewInputChunk): string | null {
	for (const file of changedFileAdditions(chunk)) {
		const risk = discoveryRisks.find((entry) => entry.matches(file.path, file.added));
		if (risk !== undefined) return risk.reason;
	}
	return null;
}

function changedFileAdditions(
	chunk: ReviewInputChunk,
): readonly { readonly path: string; readonly added: string }[] {
	const files = parseDiff(chunk.diff);
	const solePath = chunk.changedLines.size === 1 ? [...chunk.changedLines.keys()][0] : undefined;
	return files.flatMap((file) => {
		const encoded = file.to === "/dev/null" ? file.from : file.to;
		const path = encoded === undefined ? solePath : decodeGitDiffPath(encoded);
		if (path === undefined || !chunk.changedLines.has(path)) return [];
		const added = file.chunks
			.flatMap((hunk) =>
				hunk.changes
					.filter((change) => change.type === "add")
					.map((change) => change.content),
			)
			.join("\n");
		return [{ path, added }];
	});
}

export function mergeIndependentInvestigation(
	first: ReviewInvestigation,
	second: ReviewInvestigation,
): ReviewInvestigation {
	if (first.kind !== "verified" || second.kind !== "verified") return second;
	const combined = {
		reviewedPaths: [
			...new Set([...first.conclusion.reviewedPaths, ...second.conclusion.reviewedPaths]),
		],
		hypotheses: [...first.conclusion.hypotheses, ...second.conclusion.hypotheses],
	};
	const gaps = [first.conclusion, second.conclusion].flatMap((item) =>
		item.status === "incomplete" ? item.gaps : [],
	);
	const conclusion: ReviewConclusion =
		gaps.length > 0
			? { status: "incomplete", ...combined, gaps: [...new Set(gaps)] }
			: { status: "complete", ...combined };
	return {
		kind: "verified",
		context: second.context,
		exchanges: [...first.exchanges, ...second.exchanges],
		conclusion,
	};
}
