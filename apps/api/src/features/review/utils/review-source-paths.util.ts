import { Buffer } from "node:buffer";
import { posix } from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const RELATIVE_IMPORT =
	/(?:\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?|\b(?:import|require)\s*\(\s*)["'](\.[^"'\n]+)["']/g;
const GIT_PATH_ENCODING = /^(?:[^\\]|\\(?:[0-3][0-7]{2}|[abfnrtv\\"]))*$/;
const GIT_ESCAPE_BYTES: Readonly<Record<string, number>> = {
	a: 7,
	b: 8,
	f: 12,
	n: 10,
	r: 13,
	t: 9,
	v: 11,
	"\\": 92,
	'"': 34,
};

/** Git C-quotes UTF8 bytes in filenames; GitHub reads and anchors use decoded paths. */
export function decodeGitDiffPath(path: string): string {
	if (!GIT_PATH_ENCODING.test(path)) throw new Error("Invalid Git diff path encoding.");
	const parts: Buffer[] = [];
	let offset = 0;
	for (const match of path.matchAll(/\\([0-3][0-7]{2}|[abfnrtv\\"])/g)) {
		parts.push(Buffer.from(path.slice(offset, match.index)));
		parts.push(Buffer.from([gitEscapeByte(match[1]!)]));
		offset = match.index + match[0].length;
	}
	parts.push(Buffer.from(path.slice(offset)));
	return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts));
}

function gitEscapeByte(escape: string): number {
	return GIT_ESCAPE_BYTES[escape] ?? Number.parseInt(escape, 8);
}

/** Only repository-local references can add context; imports never grant access. */
export function reviewSupportingPathCandidates(path: string, content: string): readonly string[] {
	const candidates = new Set<string>();
	for (const match of content.matchAll(RELATIVE_IMPORT)) {
		const reference = match[1]!;
		const resolved = posix.normalize(posix.join(posix.dirname(path), reference));
		if (!isRepositoryPath(resolved)) continue;
		for (const candidate of modulePathCandidates(resolved)) candidates.add(candidate);
	}
	for (const candidate of relatedTestPaths(path)) candidates.add(candidate);
	return [...candidates];
}

export function isRepositoryPath(path: string): boolean {
	if (posix.isAbsolute(path) || path.includes("\0")) return false;
	return (
		posix.normalize(path) === path &&
		path.split("/").every((segment) => !["", ".", ".."].includes(segment))
	);
}

function modulePathCandidates(path: string): readonly string[] {
	const extension = posix.extname(path);
	if (extension === "")
		return [
			path,
			...SOURCE_EXTENSIONS.map((suffix) => path + suffix),
			...SOURCE_EXTENSIONS.map((suffix) => `${path}/index${suffix}`),
		];
	if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension))
		return [
			path,
			...[".ts", ".tsx", ".mts", ".cts"].map(
				(suffix) => path.slice(0, -extension.length) + suffix,
			),
		];
	return [path];
}

function relatedTestPaths(path: string): readonly string[] {
	const extension = posix.extname(path);
	if (!SOURCE_EXTENSIONS.includes(extension) || /\.(?:test|spec)\.[^.]+$/.test(path)) return [];
	const name = posix.basename(path, extension);
	const sourceRoot = path.indexOf("src/");
	const packageRoot = sourceRoot === -1 ? "" : path.slice(0, sourceRoot);
	const directories = [
		posix.dirname(path),
		posix.join(posix.dirname(path), "__tests__"),
		posix.join(packageRoot, "tests"),
	];
	return directories.flatMap((directory) => [
		posix.join(directory, `${name}.test${extension}`),
		posix.join(directory, `${name}.spec${extension}`),
	]);
}
