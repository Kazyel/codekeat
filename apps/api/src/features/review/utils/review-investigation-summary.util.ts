import type { ReviewConclusion } from "../types/review-conclusion.types.js";
import type { ReviewInvestigationSummary } from "../types/review-repository.types.js";
import { decodeReviewCheckpoint } from "./review-work-codec.util.js";

interface InvestigationCheckpoint {
	readonly status: "pending" | "running" | "completed" | "split";
	readonly resultJson: string | null;
}

export function summarizeReviewInvestigation(
	checkpoints: readonly InvestigationCheckpoint[],
): ReviewInvestigationSummary {
	const conclusions = checkpoints.flatMap(checkpointConclusions);
	if (conclusions.length === 0) return { status: "unrecorded", unitCount: checkpoints.length };
	const hypotheses = conclusions.flatMap((conclusion) => conclusion.hypotheses);
	const complete =
		conclusions.length === checkpoints.length &&
		conclusions.every((entry) => entry.status === "complete");
	return {
		status: complete ? "complete" : "incomplete",
		unitCount: checkpoints.length,
		recordedUnitCount: conclusions.length,
		reviewedPathCount: new Set(conclusions.flatMap((entry) => entry.reviewedPaths)).size,
		scenarioCount: hypotheses.length,
		refutedScenarioCount: hypotheses.filter((entry) => entry.outcome === "refuted").length,
		candidateScenarioCount: hypotheses.filter((entry) => entry.outcome === "candidate").length,
		unresolvedScenarioCount: hypotheses.filter((entry) => entry.outcome === "unresolved")
			.length,
		gapCount: conclusions.reduce(
			(count, entry) => count + (entry.status === "incomplete" ? entry.gaps.length : 0),
			0,
		),
	};
}

function checkpointConclusions(checkpoint: InvestigationCheckpoint): readonly ReviewConclusion[] {
	if (checkpoint.status !== "completed" || checkpoint.resultJson === null)
		throw new Error("Completed review run has an unfinished investigation checkpoint.");
	const {
		result: { investigation },
	} = decodeReviewCheckpoint(checkpoint.resultJson);
	return investigation.kind === "verified" ? [investigation.conclusion] : [];
}
