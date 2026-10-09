import type { ReviewEvidenceRange } from "../types/review-evidence.types.js";
import type { ReviewSourceReadPage, ReviewSourceReadResult } from "../types/review-source.types.js";

const SOURCE_PAGE_COLUMNS = 4_096;

export function reviewEvidenceSelectionNeedsContinuation(range: ReviewEvidenceRange): boolean {
	if (range.page.kind !== "loaded" || range.selection === null) return false;
	if (range.page.endLine < range.selection.endLine) return true;
	return (
		range.page.endLine === range.selection.endLine &&
		range.page.endColumn < range.selection.endColumn
	);
}

/** Transport pages preserve an explicit continuation to the unchanged original. */
export function boundReviewEvidencePage(page: ReviewSourceReadResult): ReviewSourceReadResult {
	if (page.kind !== "loaded" || page.content.length <= SOURCE_PAGE_COLUMNS) return page;
	const lastNewline = page.content.lastIndexOf("\n", SOURCE_PAGE_COLUMNS - 1);
	if (lastNewline >= 0) return boundedLines(page, lastNewline + 1);
	return {
		...page,
		content: page.content.slice(0, SOURCE_PAGE_COLUMNS),
		endLine: page.startLine,
		endColumn: page.startColumn + SOURCE_PAGE_COLUMNS,
		nextRange: {
			kind: "columns",
			line: page.startLine,
			startColumn: page.startColumn + SOURCE_PAGE_COLUMNS,
			columnCount: SOURCE_PAGE_COLUMNS,
		},
	};
}

export function selectReviewEvidenceRange(
	page: ReviewSourceReadResult,
	line: number,
): ReviewEvidenceRange {
	if (page.kind !== "loaded") return { enclosure: "file_window", selection: null, page };
	const enclosure = functionEnclosure(page.content, line - page.startLine);
	if (enclosure === null) return evidenceRange("file_window", page);
	return selectedFunctionPage(page, enclosure);
}

function selectedFunctionPage(
	page: ReviewSourceReadPage,
	enclosure: { readonly start: number; readonly end: number },
): ReviewEvidenceRange {
	const lines = page.content.split("\n");
	const terminator = enclosure.end < lines.length - 1 ? "\n" : "";
	const content = lines.slice(enclosure.start, enclosure.end + 1).join("\n") + terminator;
	const endLine = page.startLine + enclosure.end;
	return evidenceRange("function", {
		...page,
		content,
		startLine: page.startLine + enclosure.start,
		endLine,
		startColumn: 0,
		endColumn: lines[enclosure.end]!.length + terminator.length,
		nextRange:
			endLine < page.totalLines
				? { kind: "lines", startLine: endLine + 1, lineCount: 200 }
				: null,
	});
}

function evidenceRange(
	enclosure: ReviewEvidenceRange["enclosure"],
	page: ReviewSourceReadPage,
): ReviewEvidenceRange {
	return {
		enclosure,
		selection: { startLine: page.startLine, endLine: page.endLine, endColumn: page.endColumn },
		page: boundReviewEvidencePage(page),
	};
}

/** Only simple named declarations are recognized. Ambiguous syntax remains a file window. */
function functionEnclosure(
	content: string,
	targetLine: number,
): { readonly start: number; readonly end: number } | null {
	const masked = maskQuotedText(content);
	if (masked === null) return null;
	const lines = masked.split("\n");
	const signature =
		/^[\t ]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+\s*\([^{};]*\)\s*(?::[\w.<>[\]|,\s]+)?\{/gm;
	const starts = [...masked.matchAll(signature)].map(
		(match) => masked.slice(0, match.index).split("\n").length - 1,
	);
	for (const start of starts.reverse().filter((start) => start <= targetLine)) {
		const end = declarationEnd(lines, start);
		if (end !== null && end >= targetLine) return { start, end };
	}
	return null;
}

function declarationEnd(lines: readonly string[], start: number): number | null {
	let depth = 0;
	let opened = false;
	for (let line = start; line < lines.length; line++) {
		const text = lines[line]!;
		depth += braceChange(text);
		if (text.includes("{")) opened = true;
		if (opened && depth === 0) return line;
	}
	return null;
}

function braceChange(line: string): number {
	return (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
}

function maskQuotedText(content: string): string | null {
	let ambiguous = false;
	const tokens = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[`/]/g;
	const masked = content.replace(tokens, (token) => {
		if (token === "`" || token === "/") ambiguous = true;
		return token.replace(/[^\n]/g, " ");
	});
	return ambiguous || /["']/.test(masked) ? null : masked;
}

function boundedLines(page: ReviewSourceReadPage, end: number): ReviewSourceReadPage {
	const content = page.content.slice(0, end);
	const lines = content.split("\n");
	const endLine = page.startLine + lines.length - 2;
	return {
		...page,
		content,
		endLine,
		endColumn: (lines.at(-2)?.length ?? 0) + 1,
		nextRange: { kind: "lines", startLine: endLine + 1, lineCount: 200 },
	};
}
