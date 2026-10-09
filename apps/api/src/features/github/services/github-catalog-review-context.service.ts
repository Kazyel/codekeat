import { Effect } from "effect";
import {
	reviewSupportingPathCandidates,
	type ReviewContextFile,
	type ReviewInputChunk,
	type ReviewRepositoryContext,
	type ReviewSourceCatalog,
	type ReviewSourceEntry,
	type ReviewSourceRevision,
	type ReviewSourceUnavailable,
} from "#features/review";

type Selection =
	| { readonly kind: "preload"; readonly entry: ReviewSourceEntry }
	| { readonly kind: "context"; readonly file: ReviewContextFile };

const ROOT_DOCUMENTS = [
	"AGENTS.md",
	"README.md",
	".codekeat.yml",
	".codekeat/README.md",
	".codekeat/domain.md",
	".codekeat/integrations.md",
];

/** Whole-file bootstrap only. Metadata estimates select preloads; model token counting remains authoritative. */
export async function loadCatalogReviewContext(
	catalog: ReviewSourceCatalog,
	chunks: readonly ReviewInputChunk[],
	body: string | null,
	inputTokenLimit: number,
	signal: AbortSignal,
): Promise<ReviewRepositoryContext> {
	const head = catalog.revisions.find((revision) => revision.role === "head")!;
	const changed = [...new Set(chunks.flatMap((chunk) => [...chunk.changedLines.keys()]))];
	const paths = new Set([...ROOT_DOCUMENTS, ...changed]);
	const listing = yieldRequest((requestSignal) =>
		catalog.list(
			{ role: "head", prefix: "", cursor: null, limit: Number.MAX_SAFE_INTEGER },
			requestSignal,
		),
	);
	return Effect.runPromise(
		Effect.gen(function* () {
			const manifest = yield* listing;
			if (manifest.kind !== "page") return unavailableContext(head, paths, manifest);
			const initialPaths = new Set([
				...ROOT_DOCUMENTS,
				...manifest.entries
					.filter((entry) => entry.path.startsWith(".codekeat/"))
					.map((entry) => entry.path),
				...changed,
			]);
			const entries = new Map(manifest.entries.map((entry) => [entry.path, entry]));
			// Reserve half the effective token window for instructions/tools/output. Two tokens per UTF8
			// byte account conservatively for JSON escaping; exact provider count can trigger lazy recovery.
			const packetDiffBytes = chunks.reduce(
				(largest, chunk) => Math.max(largest, Buffer.byteLength(chunk.diff)),
				0,
			);
			let remaining = Math.max(
				0,
				Math.floor(inputTokenLimit / 2) -
					2 * (Buffer.byteLength(body ?? "") + packetDiffBytes),
			);
			const first = selectPreloads(initialPaths, entries, remaining);
			remaining = first.remaining;
			const files = yield* readSelected(catalog, first.files);
			const supporting = supportingPaths(files, new Set(changed), initialPaths, entries);
			const next = selectPreloads(supporting, entries, remaining);
			const supports = yield* readSelected(catalog, next.files);
			return { ...head, files: [...files, ...supports], omittedFileCount: 0 };
		}),
		{ signal },
	);
}

function selectPreloads(
	paths: Iterable<string>,
	entries: ReadonlyMap<string, ReviewSourceEntry>,
	budget: number,
): { readonly files: readonly Selection[]; readonly remaining: number } {
	const files: Selection[] = [];
	let remaining = budget;
	for (const path of paths) {
		const entry = entries.get(path);
		if (entry === undefined) {
			files.push({ kind: "context", file: { kind: "missing", path } });
			continue;
		}
		const fits = preloadFits(entry, remaining);
		if (fits) remaining -= 2 * entry.sizeBytes!;
		files.push(
			fits
				? { kind: "preload", entry }
				: { kind: "context", file: { kind: "catalog", path, source: entry } },
		);
	}
	return { files, remaining };
}
function preloadFits(entry: ReviewSourceEntry, budget: number): boolean {
	return entry.kind === "file" && entry.sizeBytes !== null && 2 * entry.sizeBytes <= budget;
}
function readSelected(
	catalog: ReviewSourceCatalog,
	files: readonly Selection[],
): Effect.Effect<readonly ReviewContextFile[]> {
	return Effect.forEach(
		files,
		(selection) => {
			if (selection.kind === "context") return Effect.succeed(selection.file);
			const file = selection.entry;
			return yieldRequest((signal) =>
				catalog.read(
					{
						source: file,
						range: { kind: "lines", startLine: 1, lineCount: Number.MAX_SAFE_INTEGER },
					},
					signal,
				),
			).pipe(
				Effect.map((result): ReviewContextFile => {
					if (result.kind === "loaded")
						return { kind: "loaded", path: file.path, content: result.content };
					if (result.kind === "missing") return { kind: "missing", path: file.path };
					return { kind: "unavailable", path: file.path, reason: "request_failed" };
				}),
			);
		},
		{ concurrency: 4 },
	);
}
function supportingPaths(
	files: readonly ReviewContextFile[],
	changed: ReadonlySet<string>,
	selected: ReadonlySet<string>,
	entries: ReadonlyMap<string, ReviewSourceEntry>,
): readonly string[] {
	return [
		...new Set(
			files.flatMap((file) =>
				file.kind === "loaded" && changed.has(file.path)
					? reviewSupportingPathCandidates(file.path, file.content)
					: [],
			),
		),
	].filter((path) => !selected.has(path) && entries.has(path));
}
function unavailableContext(
	head: Pick<ReviewSourceRevision, "repositoryFullName" | "revision">,
	paths: Iterable<string>,
	failure: ReviewSourceUnavailable,
): ReviewRepositoryContext {
	return {
		...head,
		files: [...paths].map((path) => ({
			kind: "unavailable",
			path,
			reason:
				failure.reason === "repository_unavailable"
					? "head_repository_unavailable"
					: "request_failed",
		})),
		omittedFileCount: 0,
	};
}
function yieldRequest<A>(request: (signal: AbortSignal) => Promise<A>): Effect.Effect<A> {
	return Effect.promise(request);
}
