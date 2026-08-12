import type { FindingInput, PublishableReviewReport } from "@codekeat/database";

const severityOrder = ["critical", "high", "medium", "low"] as const;

export function formatReviewReport(report: PublishableReviewReport): string {
  const header = ["## Codekeat — revisão consultiva", `Commit: \`${report.headSha.slice(0, 7)}\``];
  const content = report.findings.length === 0 ? noFindingsMessage() : findingsMessage(report);
  return [...header, content, "Isso não substitui a revisão humana."].join("\n\n");
}

function noFindingsMessage(): string {
  return "✅ Não encontramos problemas concretos neste commit.";
}

function findingsMessage(report: PublishableReviewReport): string {
  const sections = severityOrder.flatMap((severity) => {
    const findings = report.findings.filter((finding) => finding.severity === severity);
    return findings.length === 0 ? [] : formatSeveritySection(report, severity, findings);
  });
  return ["Encontramos observações concretas:", ...sections].join("\n\n");
}

function formatSeveritySection(
  report: PublishableReviewReport,
  severity: FindingInput["severity"],
  findings: readonly FindingInput[],
): string {
  const heading = `### ${severityLabel(severity)} (${findings.length})`;
  return [heading, ...findings.map((finding) => formatFinding(report, finding))].join("\n");
}

function formatFinding(report: PublishableReviewReport, finding: FindingInput): string {
  const url = `https://github.com/${report.repositoryFullName}/blob/${report.headSha}/${encodePath(finding.path)}#L${finding.line}`;
  return [
    `- [\`${escapeMarkdown(finding.path)}:${finding.line}\`](${url}) — **${escapeMarkdown(finding.title)}**`,
    `  ${escapeMarkdown(finding.rationale)}`,
  ].join("\n");
}

function severityLabel(severity: FindingInput["severity"]): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]<>()[\]#+!|])/g, "\\$1").replace(/@/g, "@\u200b");
}
