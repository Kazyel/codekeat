import { z } from "zod";
import {
	ReviewConclusionValidationError,
	type ReviewConclusion,
	type ReviewContextExchange,
	type ReviewInput,
	type ReviewSourceRevision,
	reviewSourceLineCount,
} from "#features/review";

const role = z.enum(["head", "before", "pull_request", "investigation"]);
const range = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("lines"), startLine: z.number(), lineCount: z.number() }),
	z.object({
		kind: z.literal("columns"),
		line: z.number(),
		startColumn: z.number(),
		columnCount: z.number(),
	}),
]);
const loaded = z.object({
	kind: z.literal("loaded"),
	source: z.object({ role, path: z.string(), revision: z.string() }),
	content: z.string(),
	startLine: z.number().int().nonnegative(),
	endLine: z.number().int().nonnegative(),
	startColumn: z.number().int().nonnegative(),
	endColumn: z.number().int().nonnegative(),
	nextRange: range.nullable(),
});
const read = z.union([loaded, z.object({ kind: z.enum(["missing", "unavailable"]) })]);
const evidencePacket = z.object({
	head: z.object({ page: read }),
	before: z.object({ page: read }).nullable(),
	supportingRanges: z.array(z.object({ range: z.object({ page: read }) })),
});
interface ReadLine {
	readonly role: z.infer<typeof role>;
	readonly path: string;
	readonly revision: string;
	readonly line: number;
	readonly start: number;
	readonly end: number;
	readonly completeEnd: boolean;
}

/** A source citation is accepted only when its complete lines were actually delivered. */
export function validateReviewEvidenceProvenance(
	conclusion: ReviewConclusion,
	input: ReviewInput,
	exchanges: readonly ReviewContextExchange[],
	revisions: readonly ReviewSourceRevision[],
): void {
	const pages = exchanges.flatMap(exchangePages);
	const reads = pages.flatMap(pageLines);
	for (const [hypothesisIndex, hypothesis] of conclusion.hypotheses.entries()) {
		for (const [evidenceIndex, evidence] of hypothesis.evidence.entries()) {
			validateCitation(evidence, { hypothesisIndex, evidenceIndex }, input, revisions, reads);
		}
	}
}

type Evidence = ReviewConclusion["hypotheses"][number]["evidence"][number];
function validateCitation(
	evidence: Evidence,
	indices: { readonly hypothesisIndex: number; readonly evidenceIndex: number },
	input: ReviewInput,
	revisions: readonly ReviewSourceRevision[],
	reads: readonly ReadLine[],
): void {
	if (!matchesSnapshot(evidence, input, revisions))
		throw new ReviewConclusionValidationError({
			code: "evidence_revision_mismatch",
			...indices,
		});
	if (inlineEvidence(evidence, input)) return;
	if (!observedEvidence(evidence, reads))
		throw new ReviewConclusionValidationError({ code: "evidence_not_delivered", ...indices });
}

function matchesSnapshot(
	evidence: Evidence,
	input: ReviewInput,
	revisions: readonly ReviewSourceRevision[],
): boolean {
	if (evidence.role === "head") return evidence.revision === input.headSha;
	if (evidence.role === "before")
		return evidence.revision === revisions.find((entry) => entry.role === "before")?.revision;
	return true;
}

function inlineEvidence(evidence: Evidence, input: ReviewInput): boolean {
	if (evidence.role !== "head" || input.repositoryContext.revision !== evidence.revision)
		return false;
	return input.repositoryContext.files.some(
		(file) =>
			file.kind === "loaded" &&
			file.path === evidence.path &&
			evidence.endLine <= reviewSourceLineCount(file.content),
	);
}

function exchangePages(exchange: ReviewContextExchange): readonly z.infer<typeof loaded>[] {
	if (!["source_read", "source_evidence"].includes(exchange.tool)) return [];
	try {
		const response: unknown = JSON.parse(exchange.responseJson);
		if (exchange.tool === "source_read") {
			const page = read.parse(response);
			return page.kind === "loaded" ? [page] : [];
		}
		return packetPages(evidencePacket.parse(response));
	} catch {
		throw new ReviewConclusionValidationError({ code: "evidence_receipt_invalid" });
	}
}

function packetPages(packet: z.infer<typeof evidencePacket>): readonly z.infer<typeof loaded>[] {
	const before = packet.before === null ? [] : [packet.before.page];
	return [
		packet.head.page,
		...before,
		...packet.supportingRanges.map((entry) => entry.range.page),
	].filter((page): page is z.infer<typeof loaded> => page.kind === "loaded");
}

function pageLines(page: z.infer<typeof loaded>): readonly ReadLine[] {
	if (loadedEmptyLine(page))
		return [{ ...page.source, line: page.startLine, start: 0, end: 0, completeEnd: true }];
	const segments = page.content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	return segments.map((content, index) => {
		const line = page.startLine + index;
		const start = index === 0 ? page.startColumn : 0;
		return {
			...page.source,
			line,
			start,
			end: start + content.length,
			completeEnd: content.endsWith("\n") || !continuesLine(page, line),
		};
	});
}

function loadedEmptyLine(page: z.infer<typeof loaded>): boolean {
	return (
		page.content === "" &&
		page.startLine > 0 &&
		page.startLine === page.endLine &&
		[page.startColumn, page.endColumn].every((column) => column === 0) &&
		page.nextRange === null
	);
}

function continuesLine(page: z.infer<typeof loaded>, line: number): boolean {
	return (
		page.nextRange?.kind === "columns" &&
		page.nextRange.line === line &&
		page.nextRange.startColumn > 0
	);
}

function observedEvidence(evidence: Evidence, reads: readonly ReadLine[]): boolean {
	const matching = reads.filter(
		(entry) =>
			entry.role === evidence.role &&
			entry.path === evidence.path &&
			entry.revision === evidence.revision,
	);
	const lastDeliveredLine = matching.reduce((last, entry) => Math.max(last, entry.line), 0);
	if (evidence.endLine > lastDeliveredLine) return false;
	for (let line = evidence.startLine; line <= evidence.endLine; line++) {
		if (!completeLine(matching.filter((entry) => entry.line === line))) return false;
	}
	return true;
}

function completeLine(reads: readonly ReadLine[]): boolean {
	let end = 0;
	let completeEnd: number | null = null;
	for (const read of [...reads].sort((left, right) => left.start - right.start)) {
		if (read.start > end) break;
		end = Math.max(end, read.end);
		if (read.completeEnd) completeEnd = read.end;
	}
	return completeEnd !== null && end >= completeEnd;
}
