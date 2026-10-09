import {
	reviewEvaluationResultSchema,
	reviewEvaluationLabelsSchema,
} from "./review-evaluation.schemas.js";
import type {
	ReviewEvaluationLabels,
	ReviewEvaluationResult,
} from "./review-evaluation.schemas.js";

export interface ReviewEvaluationScore {
	readonly knownDefects: number;
	readonly detectedDefects: number;
	readonly recall: number | null;
	readonly truePositives: number;
	readonly falsePositives: number;
	readonly unlabelledFindings: number;
	readonly precision: number | null;
	readonly incompleteCases: number;
	readonly measuredCases: number;
	readonly durationP50Ms: number;
	readonly durationP95Ms: number;
	readonly knownCostUsdMicros: number;
	readonly unknownUsageCases: number;
	readonly knownUsageSteps: number;
	readonly requestCount: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheTokens: number;
}

/** Human annotations, never provider judgments, determine precision and defect matching. */
export function scoreReviewEvaluation(
	result: ReviewEvaluationResult,
	labels: ReviewEvaluationLabels,
): ReviewEvaluationScore {
	reviewEvaluationResultSchema.parse(result);
	reviewEvaluationLabelsSchema.parse(labels);
	const labelledCases = labelledCaseMap(result, labels);
	const detected = detectedDefects(result, labels, labelledCases);
	const truePositives = labels.annotations.filter(
		(entry) => entry.verdict === "true_positive",
	).length;
	const falsePositives = labels.annotations.filter(
		(entry) => entry.verdict === "false_positive",
	).length;
	const findings = result.cases.reduce((sum, entry) => sum + entry.findings.length, 0);
	const knownDefects = labels.cases.reduce((sum, entry) => {
		if (new Set(entry.defects.map((defect) => defect.id)).size !== entry.defects.length)
			throw new Error("Duplicate defect id.");
		return sum + entry.defects.length;
	}, 0);
	const measured = result.cases.filter(isMeasuredCase);
	const usages = result.cases
		.flatMap((entry) => [entry.reviewUsage, entry.judgeUsage])
		.filter((entry) => entry !== null);
	return {
		knownDefects,
		detectedDefects: detected.size,
		recall: ratio(detected.size, knownDefects),
		truePositives,
		falsePositives,
		unlabelledFindings: findings - truePositives - falsePositives,
		precision: ratio(truePositives, truePositives + falsePositives),
		incompleteCases: result.cases.filter((entry) => entry.status !== "complete").length,
		measuredCases: measured.length,
		durationP50Ms: percentile(
			measured.map((entry) => entry.durationMs),
			0.5,
		),
		durationP95Ms: percentile(
			measured.map((entry) => entry.durationMs),
			0.95,
		),
		knownCostUsdMicros: usages.reduce((sum, entry) => sum + entry.costUsdMicros, 0),
		unknownUsageCases: result.cases.filter(unknownUsage).length,
		knownUsageSteps: result.cases.reduce((sum, entry) => sum + entry.knownUsageSteps, 0),
		requestCount: result.cases.reduce((sum, entry) => sum + entry.requestCount, 0),
		inputTokens: usages.reduce((sum, entry) => sum + entry.inputTokens, 0),
		outputTokens: usages.reduce((sum, entry) => sum + entry.outputTokens, 0),
		cacheTokens: usages.reduce((sum, entry) => sum + entry.cacheTokens, 0),
	};
}
function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}
function percentile(values: readonly number[], fraction: number): number {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function labelledCaseMap(
	result: ReviewEvaluationResult,
	labels: ReviewEvaluationLabels,
): Map<string, ReviewEvaluationLabels["cases"][number]> {
	if (labels.corpusHash !== result.corpusHash) throw new Error("Evaluation corpus mismatch.");
	const cases = new Map(labels.cases.map((entry) => [entry.caseId, entry]));
	if (cases.size !== labels.cases.length) throw new Error("Duplicate labelled case.");
	if (
		cases.size !== result.cases.length ||
		result.cases.some((entry) => !cases.has(entry.caseId))
	)
		throw new Error("Labels must cover the evaluated cases exactly.");
	return cases;
}
function detectedDefects(
	result: ReviewEvaluationResult,
	labels: ReviewEvaluationLabels,
	cases: Map<string, ReviewEvaluationLabels["cases"][number]>,
): Set<string> {
	const runs = new Map(result.cases.map((entry) => [entry.runId, entry]));
	const annotated = new Set<string>();
	const detected = new Set<string>();
	for (const annotation of labels.annotations) {
		const key = `${annotation.runId}:${annotation.findingIndex}`;
		if (annotated.has(key)) throw new Error("Duplicate finding annotation.");
		annotated.add(key);
		const run = annotatedRun(annotation, runs);
		const match = matchedDefect(annotation, run, cases.get(run.caseId)!);
		if (match !== null) detected.add(match);
	}
	return detected;
}
function annotatedRun(
	annotation: ReviewEvaluationLabels["annotations"][number],
	runs: Map<string, ReviewEvaluationResult["cases"][number]>,
): ReviewEvaluationResult["cases"][number] {
	const run = runs.get(annotation.runId);
	if (run === undefined || run.findings[annotation.findingIndex] === undefined)
		throw new Error("Invalid finding annotation.");
	return run;
}
function matchedDefect(
	annotation: ReviewEvaluationLabels["annotations"][number],
	run: ReviewEvaluationResult["cases"][number],
	label: ReviewEvaluationLabels["cases"][number],
): string | null {
	if (annotation.defectId === null) return null;
	const defect = label.defects.find((entry) => entry.id === annotation.defectId);
	if (defect === undefined) throw new Error("Unknown defect id.");
	const finding = run.findings[annotation.findingIndex]!;
	validateDefectRange(finding, defect);
	return `${run.caseId}:${defect.id}`;
}
function validateDefectRange(
	finding: ReviewEvaluationResult["cases"][number]["findings"][number],
	defect: ReviewEvaluationLabels["cases"][number]["defects"][number],
): void {
	if (
		defect.path !== finding.path ||
		finding.line < defect.startLine ||
		finding.line > defect.endLine
	)
		throw new Error("Defect match is outside its labelled source range.");
}
function unknownUsage(entry: ReviewEvaluationResult["cases"][number]): boolean {
	return (
		entry.metrics.some(hasUnknownRequestUsage) ||
		(entry.knownUsageSteps > 0 && entry.reviewUsage === null)
	);
}
function hasUnknownRequestUsage(
	metric: ReviewEvaluationResult["cases"][number]["metrics"][number],
): boolean {
	return (
		(metric.phase === "generation" || metric.phase === "judge") &&
		metric.requestCount > 0 &&
		metric.usage === null
	);
}
function isMeasuredCase(entry: ReviewEvaluationResult["cases"][number]): boolean {
	return entry.status !== "pending" && entry.status !== "running";
}
