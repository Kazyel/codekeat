import { createHash } from "node:crypto";
import { z } from "zod";
import parseDiff, { type File, type Chunk, type Change } from "parse-diff";
import { reviewConclusionSchema } from "../types/review-conclusion.types.js";
import { reviewMetricSchema } from "../types/review-metrics.types.js";
import { isRepositoryPath, decodeGitDiffPath } from "../utils/review-source-paths.util.js";

const id = z.string().regex(/^[A-Za-z0-9_-]+$/);
const sha = z.string().regex(/^[a-f0-9]{40,64}$/);
const source = z
	.object({
		role: z.enum(["head", "before"]),
		path: z.string().refine(isRepositoryPath),
		revision: sha,
		content: z.string(),
		contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	})
	.strict()
	.refine((value) => value.contentHash === contentHash(value.content), "Source hash mismatch");
const chunk = z
	.object({
		diff: z.string().min(1),
		referenceBefore: z.string(),
		referenceAfter: z.string(),
		changedLines: z.record(
			z.string().refine(isRepositoryPath),
			z
				.array(z.number().int().positive())
				.refine((lines) => new Set(lines).size === lines.length, "Duplicate changed line"),
		),
	})
	.strict();
const evaluationCase = z
	.object({
		id,
		repositoryFullName: z.string().regex(/^[^/]+\/[^/]+$/),
		headSha: sha,
		baseSha: sha,
		mergeBaseSha: sha,
		title: z.string().min(1),
		body: z.string().nullable(),
		chunks: z.array(chunk).min(1),
		sources: z.array(source),
	})
	.strict()
	.superRefine((value, context) => {
		const seen = new Set<string>();
		for (const document of value.sources) {
			const key = `${document.role}:${document.path}`;
			if (seen.has(key))
				context.addIssue({ code: "custom", message: "Duplicate source identity" });
			seen.add(key);
			if (
				document.revision !==
				(document.role === "head" ? value.headSha : value.mergeBaseSha)
			)
				context.addIssue({ code: "custom", message: "Source revision mismatch" });
		}
		validateFrozenDiffs(value.chunks, value.sources, context);
	});

export const reviewEvaluationManifestSchema = z
	.object({
		version: z.literal(1),
		corpusId: id,
		model: z
			.object({
				id: z.string().min(1),
				apiName: z.string().min(1),
				inputNanoUsdPerToken: z.number().nonnegative(),
				cachedInputNanoUsdPerToken: z.number().nonnegative(),
				outputNanoUsdPerToken: z.number().nonnegative(),
			})
			.strict(),
		concurrency: z.number().int().min(1).max(5).default(1),
		caseDeadlineMs: z.number().int().positive().default(1_800_000),
		cases: z.array(evaluationCase).min(1),
	})
	.strict()
	.refine(
		(value) => new Set(value.cases.map((entry) => entry.id)).size === value.cases.length,
		"Duplicate case id",
	);

export const evaluationFindingSchema = z
	.object({
		severity: z.enum(["critical", "high", "medium", "low"]),
		path: z.string().refine(isRepositoryPath),
		line: z.number().int().positive(),
		title: z.string().min(1),
		rationale: z.string().min(1),
	})
	.strict();
export const evaluationInvestigationSchema = z
	.object({
		chunkIndex: z.number().int().nonnegative(),
		conclusion: reviewConclusionSchema.nullable(),
		context: z.enum(["available", "unavailable", "not_enabled"]),
		exchanges: z.array(
			z
				.object({ tool: z.string(), argumentsJson: z.string(), responseJson: z.string() })
				.strict(),
		),
	})
	.strict();
const usage = z
	.object({
		inputTokens: z.number().int().nonnegative(),
		outputTokens: z.number().int().nonnegative(),
		cacheTokens: z.number().int().nonnegative(),
		costUsdMicros: z.number().nonnegative(),
	})
	.strict()
	.refine((value) => value.cacheTokens <= value.inputTokens, "Cached tokens exceed input");
export const reviewEvaluationResultSchema = z
	.object({
		version: z.literal(1),
		experimentId: z.uuid(),
		corpusId: id,
		corpusHash: sha,
		runtime: z
			.object({
				codeRevision: sha,
				strategy: z.string().min(1),
				model: reviewEvaluationManifestSchema.shape.model,
				concurrency: z.number().int().positive(),
				caseDeadlineMs: z.number().int().positive(),
			})
			.strict(),
		cases: z.array(
			z
				.object({
					caseId: id,
					runId: z.uuid(),
					status: z.enum([
						"pending",
						"running",
						"complete",
						"incomplete",
						"failed",
						"deadline",
						"cancelled",
					]),
					investigations: z.array(evaluationInvestigationSchema),
					durationMs: z.number().nonnegative(),
					errorCode: z.string().nullable(),
					findings: z.array(evaluationFindingSchema),
					reviewUsage: usage.nullable(),
					judgeUsage: usage.nullable(),
					knownUsageSteps: z.number().int().nonnegative(),
					requestCount: z.number().int().nonnegative(),
					metrics: z.array(reviewMetricSchema),
				})
				.strict()
				.superRefine((value, context) => {
					const failed = ["failed", "deadline", "cancelled"].includes(value.status);
					if (failed !== (value.errorCode !== null))
						context.addIssue({ code: "custom", message: "Status/error mismatch" });
					if (hasUnavailableFindings(value.status, value.findings.length))
						context.addIssue({
							code: "custom",
							message: "Unfinished and failed cases cannot publish findings",
						});
					if (
						value.status === "complete" &&
						!hasCompleteInvestigations(value.investigations)
					)
						context.addIssue({
							code: "custom",
							message: "Complete cases require complete investigation records",
						});
				}),
		),
	})
	.strict()
	.superRefine((value, context) => {
		for (const key of ["caseId", "runId"] as const)
			if (new Set(value.cases.map((entry) => entry[key])).size !== value.cases.length)
				context.addIssue({ code: "custom", message: `Duplicate ${key}` });
	});

const defect = z
	.object({
		id,
		path: z.string().refine(isRepositoryPath),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.strict()
	.refine((value) => value.endLine >= value.startLine, "Invalid defect range");
export const reviewEvaluationLabelsSchema = z
	.object({
		version: z.literal(1),
		corpusHash: sha,
		cases: z.array(z.object({ caseId: id, defects: z.array(defect) }).strict()),
		annotations: z.array(
			z
				.object({
					runId: z.uuid(),
					findingIndex: z.number().int().nonnegative(),
					verdict: z.enum(["true_positive", "false_positive", "unknown"]),
					defectId: id.nullable(),
				})
				.strict()
				.refine(
					(value) => value.verdict === "true_positive" || value.defectId === null,
					"Only true positives can match a known defect",
				),
		),
	})
	.strict();

export type ReviewEvaluationManifest = z.infer<typeof reviewEvaluationManifestSchema>;
export type ReviewEvaluationCase = ReviewEvaluationManifest["cases"][number];
export type ReviewEvaluationResult = z.infer<typeof reviewEvaluationResultSchema>;
export type ReviewEvaluationCaseResult = ReviewEvaluationResult["cases"][number];
export type ReviewEvaluationLabels = z.infer<typeof reviewEvaluationLabelsSchema>;

export function contentHash(content: string): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
export function evaluationCorpusHash(manifest: ReviewEvaluationManifest): string {
	return createHash("sha256")
		.update(JSON.stringify([manifest.corpusId, manifest.cases]))
		.digest("hex");
}

function hasCompleteInvestigations(
	investigations: readonly z.infer<typeof evaluationInvestigationSchema>[],
): boolean {
	return (
		investigations.length > 0 &&
		investigations.every((entry) => entry.conclusion?.status === "complete")
	);
}
function hasUnavailableFindings(
	status: ReviewEvaluationCaseResult["status"],
	findings: number,
): boolean {
	return status !== "complete" && status !== "incomplete" && findings > 0;
}

interface FrozenSource {
	readonly content: string;
	readonly lines: readonly string[];
}

function validateFrozenDiffs(
	chunks: readonly z.infer<typeof chunk>[],
	sources: readonly z.infer<typeof source>[],
	context: z.RefinementCtx,
): void {
	const snapshots = new Map(
		sources.map((entry) => [
			`${entry.role}:${entry.path}`,
			{ content: entry.content, lines: frozenSourceLines(entry.content) },
		]),
	);
	for (const [index, entry] of chunks.entries()) {
		try {
			validateFrozenChunk(entry, snapshots);
		} catch {
			context.addIssue({
				code: "custom",
				path: ["chunks", index],
				message: "Diff hunks, changed lines and frozen sources must agree.",
			});
		}
	}
}

function frozenSourceLines(content: string): readonly string[] {
	if (content === "") return [];
	const lines = content.split("\n");
	if (content.endsWith("\n")) lines.pop();
	return lines;
}

function validateFrozenChunk(
	entry: z.infer<typeof chunk>,
	snapshots: ReadonlyMap<string, FrozenSource>,
): void {
	const files = parseDiff(entry.diff);
	if (files.length === 0) throw new Error("Missing diff files.");
	const expected = new Map<string, Set<number>>();
	for (const file of files) {
		const before = frozenFileSource(file.from, "before", snapshots);
		const head = frozenFileSource(file.to, "head", snapshots);
		const path = diffReportablePath(file);
		const additions = expected.get(path) ?? new Set<number>();
		for (const hunk of file.chunks) {
			collectFrozenHunk(hunk, before, head, additions);
		}
		expected.set(path, additions);
	}
	validateChangedLines(entry.changedLines, expected);
}

function collectFrozenHunk(
	hunk: Chunk,
	before: FrozenSource | null,
	head: FrozenSource | null,
	additions: Set<number>,
): void {
	validateFrozenHunk(hunk, before, head);
	for (const change of hunk.changes.filter(isActualAddition)) additions.add(change.ln);
}

function frozenFileSource(
	encoded: string | undefined,
	role: "head" | "before",
	snapshots: ReadonlyMap<string, FrozenSource>,
): FrozenSource | null {
	if (encoded === "/dev/null") return null;
	if (encoded === undefined) throw new Error("Missing diff path.");
	const snapshot = snapshots.get(`${role}:${decodeGitDiffPath(encoded)}`);
	if (snapshot === undefined) throw new Error("Missing frozen source.");
	return snapshot;
}

function diffReportablePath(file: File): string {
	const encoded = file.to === "/dev/null" ? file.from : file.to;
	if (encoded === undefined) throw new Error("Missing reportable path.");
	return decodeGitDiffPath(encoded);
}

function isActualAddition(change: Change): change is Extract<Change, { readonly type: "add" }> {
	return change.type === "add" && !change.content.startsWith("\\");
}

function validateFrozenHunk(
	hunk: Chunk,
	before: FrozenSource | null,
	head: FrozenSource | null,
): void {
	const changes = hunk.changes.filter((change) => !change.content.startsWith("\\"));
	if (
		changes.filter((change) => change.type !== "add").length !== hunk.oldLines ||
		changes.filter((change) => change.type !== "del").length !== hunk.newLines
	)
		throw new Error("Incomplete diff hunk.");
	for (const change of changes) validateFrozenChange(change, before, head);
	for (const marker of hunk.changes.filter((change) => change.content.startsWith("\\")))
		validateNoNewlineMarker(marker, before, head);
}

function validateNoNewlineMarker(
	change: Change,
	before: FrozenSource | null,
	head: FrozenSource | null,
): void {
	if (change.type === "normal") {
		requireNoFinalNewline(before, change.ln1);
		requireNoFinalNewline(head, change.ln2);
		return;
	}
	requireNoFinalNewline(change.type === "add" ? head : before, change.ln);
}

function requireNoFinalNewline(snapshot: FrozenSource | null, line: number): void {
	if (snapshot === null || snapshot.content.endsWith("\n") || line !== snapshot.lines.length)
		throw new Error("Invalid newline marker.");
}

function validateFrozenChange(
	change: Change,
	before: FrozenSource | null,
	head: FrozenSource | null,
): void {
	const prefix = { normal: " ", add: "+", del: "-" }[change.type];
	if (!change.content.startsWith(prefix)) throw new Error("Invalid diff line prefix.");
	const content = change.content.slice(1);
	if (change.type === "normal") {
		validateFrozenLine(before, change.ln1, content);
		validateFrozenLine(head, change.ln2, content);
		return;
	}
	validateFrozenLine(change.type === "add" ? head : before, change.ln, content);
}

function validateFrozenLine(snapshot: FrozenSource | null, line: number, content: string): void {
	if (snapshot === null || snapshot.lines[line - 1] !== content)
		throw new Error("Frozen source line mismatch.");
}

function validateChangedLines(
	actual: Readonly<Record<string, readonly number[]>>,
	expected: ReadonlyMap<string, ReadonlySet<number>>,
): void {
	if (Object.keys(actual).length !== expected.size) throw new Error("Changed path mismatch.");
	for (const [path, additions] of expected) {
		const lines = actual[path];
		if (lines === undefined) throw new Error("Changed path missing.");
		validateChangedLineSet(lines, additions);
	}
}

function validateChangedLineSet(lines: readonly number[], additions: ReadonlySet<number>): void {
	if (lines.length !== additions.size || !lines.every((line) => additions.has(line)))
		throw new Error("Changed line mismatch.");
}
