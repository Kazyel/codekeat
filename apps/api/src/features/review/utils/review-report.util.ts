import {
	FINDING_SEVERITY_ORDER,
	SHORT_COMMIT_SHA_LENGTH,
} from "../constants/review-report.constants.js";
import type {
	PublishableReviewReport,
	ReviewInvestigationSummary,
	StoredFinding,
} from "../types/review-repository.types.js";

export function formatReviewReport(report: PublishableReviewReport): string {
	const header = [
		"## Codekeat — revisão consultiva",
		`**Escopo:** diff completo do PR no snapshot do HEAD \`${report.headSha.slice(0, SHORT_COMMIT_SHA_LENGTH)}\` — não apenas esse commit.`,
	];
	const content =
		report.findings.length === 0
			? noFindingsMessage(report.investigation)
			: findingsMessage(report);
	return [
		...header,
		content,
		...investigationMessage(report.investigation),
		"Isso não substitui a revisão humana.",
	].join("\n\n");
}

function noFindingsMessage(investigation: ReviewInvestigationSummary): string {
	switch (investigation.status) {
		case "complete":
			return "Não publicamos findings após examinar os cenários registrados para este snapshot.";
		case "incomplete":
			return "⚠️ Nenhum finding publicado. A investigação está incompleta e não permite concluir que o PR está livre de problemas.";
		case "unrecorded":
			return "Nenhum finding publicado; investigação detalhada não registrada nesta execução.";
	}
}

function investigationMessage(investigation: ReviewInvestigationSummary): readonly string[] {
	if (investigation.status === "unrecorded") return [];
	const coverage = `**Investigação registrada:** ${investigation.recordedUnitCount}/${investigation.unitCount} unidades, ${investigation.reviewedPathCount} arquivos e ${investigation.scenarioCount} cenários examinados (${investigation.refutedScenarioCount} hipóteses refutadas, ${investigation.candidateScenarioCount} candidatas e ${investigation.unresolvedScenarioCount} não resolvidas). Esses registros não comprovam a ausência de outros defeitos.`;
	if (investigation.status === "complete") return [coverage];
	return [
		coverage,
		`**Investigação incompleta:** ${investigation.gapCount} lacunas registradas e ${investigation.unitCount - investigation.recordedUnitCount} unidades sem investigação detalhada. As evidências e os detalhes das lacunas permanecem nos registros privados da análise.`,
	];
}

function findingsMessage(report: PublishableReviewReport): string {
	const sections = FINDING_SEVERITY_ORDER.flatMap((severity) => {
		const findings = report.findings.filter((finding) => finding.severity === severity);
		return findings.length === 0 ? [] : formatSeveritySection(report, severity, findings);
	});
	return ["Encontramos observações concretas no diff completo deste PR:", ...sections].join(
		"\n\n",
	);
}

function formatSeveritySection(
	report: PublishableReviewReport,
	severity: StoredFinding["severity"],
	findings: readonly StoredFinding[],
): string {
	const heading = `### ${severityLabel(severity)} (${findings.length})`;
	return [heading, ...findings.map((finding) => formatFinding(report, finding))].join("\n");
}

function formatFinding(report: PublishableReviewReport, finding: StoredFinding): string {
	const url = `https://github.com/${report.repositoryFullName}/blob/${report.headSha}/${encodePath(finding.path)}#L${finding.line}`;
	return [
		`- [\`${escapeMarkdown(finding.path)}:${finding.line}\`](${url}) — **${escapeMarkdown(finding.title)}**`,
		`  ${escapeMarkdown(finding.rationale)}`,
	].join("\n");
}

function severityLabel(severity: StoredFinding["severity"]): string {
	return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

function escapeMarkdown(value: string): string {
	return value.replace(/([\\`*_{}[\]<>()[\]#+!|])/g, "\\$1").replace(/@/g, "@\u200b");
}
