import { tool, type ToolSet } from "ai";
import { z } from "zod";
import parseDiff from "parse-diff";
import {
	reviewConclusionSchema,
	ReviewConclusionValidationError,
	type ReviewConclusionValidationFailure,
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
type CheckpointResult =
	| {
			readonly status: ReviewConclusion["status"];
			readonly pendingTools: readonly z.infer<typeof nextTool>[];
	  }
	| {
			readonly status: "correction_required";
			readonly failure: Exclude<
				ReviewConclusionValidationFailure,
				{ readonly code: "evidence_receipt_invalid" }
			>;
	  };

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
				execute: async ({ conclusion, nextTools }) =>
					this.checkpoint(conclusion, nextTools),
			}),
		};
	}

	reopen(): void {
		this.current = null;
		this.requestedTools = [];
	}

	private checkpoint(
		conclusion: ReviewConclusion,
		nextTools: readonly z.infer<typeof nextTool>[],
	): CheckpointResult {
		try {
			this.validateCheckpoint(conclusion);
		} catch (error) {
			if (!(error instanceof ReviewConclusionValidationError)) throw error;
			if (error.failure.code === "evidence_receipt_invalid") throw error;
			this.reopen();
			return { status: "correction_required", failure: error.failure };
		}
		this.current = conclusion;
		this.requestedTools = nextTools;
		return { status: conclusion.status, pendingTools: nextTools };
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
	validateFindingLocations(findings, chunk);
	validateCandidateFindings(conclusion, findings);
	validateFindingHypotheses(conclusion, findings);
}

function validateFindingLocations(
	findings: readonly ReviewFinding[],
	chunk: ReviewInputChunk,
): void {
	for (const [findingIndex, finding] of findings.entries()) {
		if (!(chunk.changedLines.get(finding.path)?.has(finding.line) ?? false))
			throw new ReviewConclusionValidationError({
				code: "finding_location_invalid",
				findingIndex,
			});
	}
}

function validateCandidateFindings(
	conclusion: ReviewConclusion,
	findings: readonly ReviewFinding[],
): void {
	for (const [hypothesisIndex, hypothesis] of conclusion.hypotheses.entries()) {
		if (hypothesis.outcome !== "candidate") continue;
		if (!findings.some((finding) => sameLocation(hypothesis, finding)))
			throw new ReviewConclusionValidationError({
				code: "candidate_missing_finding",
				hypothesisIndex,
			});
	}
}

function validateFindingHypotheses(
	conclusion: ReviewConclusion,
	findings: readonly ReviewFinding[],
): void {
	for (const [findingIndex, finding] of findings.entries()) {
		if (
			!conclusion.hypotheses.some(
				(entry) => entry.outcome === "candidate" && sameLocation(entry, finding),
			)
		)
			throw new ReviewConclusionValidationError({
				code: "finding_missing_candidate",
				findingIndex,
			});
	}
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
	for (const [changedPathIndex, path] of [...chunk.changedLines.keys()].entries()) {
		if (!covered.has(path))
			throw new ReviewConclusionValidationError({
				code: "reviewed_path_missing",
				changedPathIndex,
			});
		if (!conclusion.hypotheses.some((entry) => entry.path === path))
			throw new ReviewConclusionValidationError({
				code: "hypothesis_missing",
				changedPathIndex,
			});
	}
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
