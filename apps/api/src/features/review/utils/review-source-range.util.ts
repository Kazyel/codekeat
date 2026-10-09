import type {
	ReviewSourceDocument,
	ReviewSourceRange,
	ReviewSourceReadResult,
} from "../types/review-source.types.js";

export function reviewSourceLineCount(content: string): number {
	if (content === "") return 0;
	let count = 0;
	let offset = -1;
	while ((offset = content.indexOf("\n", offset + 1)) !== -1) count++;
	return count + (content.endsWith("\n") ? 0 : 1);
}

export function reviewSourceLineOffset(content: string, line: number): number {
	let offset = 0;
	for (let current = 1; current < line; current++) {
		const newline = content.indexOf("\n", offset);
		if (newline === -1) return content.length;
		offset = newline + 1;
	}
	return offset;
}

export function readReviewSourceRange(
	document: ReviewSourceDocument,
	range: ReviewSourceRange,
): ReviewSourceReadResult {
	const totalLines = reviewSourceLineCount(document.content);
	if (totalLines === 0)
		return {
			kind: "loaded",
			source: document.source,
			content: "",
			totalLines,
			startLine: 0,
			endLine: 0,
			startColumn: 0,
			endColumn: 0,
			nextRange: null,
		};
	return range.kind === "lines"
		? readLines(document, range, totalLines)
		: readColumns(document, range, totalLines);
}

function readLines(
	document: ReviewSourceDocument,
	range: Extract<ReviewSourceRange, { readonly kind: "lines" }>,
	totalLines: number,
): ReviewSourceReadResult {
	if (
		!positiveInteger(range.startLine) ||
		!positiveInteger(range.lineCount) ||
		range.startLine > totalLines
	)
		return invalidRange(document);
	const endLine = Math.min(totalLines, range.startLine + range.lineCount - 1);
	const start = reviewSourceLineOffset(document.content, range.startLine);
	const end = reviewSourceLineOffset(document.content, endLine + 1);
	return {
		kind: "loaded",
		source: document.source,
		content: document.content.slice(start, end),
		totalLines,
		startLine: range.startLine,
		endLine,
		startColumn: 0,
		endColumn: end - reviewSourceLineOffset(document.content, endLine),
		nextRange: endLine < totalLines ? { ...range, startLine: endLine + 1 } : null,
	};
}

function readColumns(
	document: ReviewSourceDocument,
	range: Extract<ReviewSourceRange, { readonly kind: "columns" }>,
	totalLines: number,
): ReviewSourceReadResult {
	if (!validColumnRange(range, totalLines)) return invalidRange(document);
	const start = reviewSourceLineOffset(document.content, range.line);
	const end = reviewSourceLineOffset(document.content, range.line + 1);
	if (range.startColumn >= end - start) return invalidRange(document);
	const endColumn = Math.min(end - start, range.startColumn + range.columnCount);
	return {
		kind: "loaded",
		source: document.source,
		content: document.content.slice(start + range.startColumn, start + endColumn),
		totalLines,
		startLine: range.line,
		endLine: range.line,
		startColumn: range.startColumn,
		endColumn,
		nextRange: nextColumns(range, endColumn, end - start, totalLines),
	};
}

function nextColumns(
	range: Extract<ReviewSourceRange, { readonly kind: "columns" }>,
	endColumn: number,
	lineLength: number,
	totalLines: number,
): ReviewSourceRange | null {
	if (endColumn < lineLength) return { ...range, startColumn: endColumn };
	return range.line < totalLines ? { ...range, line: range.line + 1, startColumn: 0 } : null;
}

function validColumnRange(
	range: Extract<ReviewSourceRange, { readonly kind: "columns" }>,
	totalLines: number,
): boolean {
	return (
		positiveInteger(range.line) &&
		range.line <= totalLines &&
		Number.isSafeInteger(range.startColumn) &&
		range.startColumn >= 0 &&
		positiveInteger(range.columnCount)
	);
}

function positiveInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}
function invalidRange(document: ReviewSourceDocument): ReviewSourceReadResult {
	return { kind: "unavailable", source: document.source, reason: "invalid_request" };
}
