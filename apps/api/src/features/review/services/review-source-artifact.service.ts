import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import type {
	ReviewSourceDocument,
	ReviewSourceEntry,
	ReviewSourceIdentity,
	ReviewSourceReference,
} from "../types/review-source.types.js";
import { isRepositoryPath } from "../utils/review-source-paths.util.js";

const REFERENCE_SCHEMA = z.object({
	role: z.enum(["head", "before", "pull_request", "investigation"]),
	path: z.string().refine(isRepositoryPath),
	repositoryFullName: z
		.string()
		.regex(/^[^/]+\/[^/]+$/)
		.nullable(),
	revision: z.string().min(1),
	contentHash: z.string().regex(/^(?:sha256:[a-f0-9]{64}|git:[a-f0-9]{40})$/),
});
const ARTIFACT_SCHEMA = z.object({
	source: REFERENCE_SCHEMA,
	storageHash: z.string().regex(/^[a-f0-9]{64}$/),
	sizeBytes: z.number().int().nonnegative(),
});
type Artifact = z.infer<typeof ARTIFACT_SCHEMA>;

/** Private, immutable blobs outlive an attempt so checkpoints can reopen exact references. */
export class ReviewSourceArtifactService {
	private readonly directory: string;
	constructor(artifactDirectory: string, reviewRunId: string) {
		this.directory = join(artifactDirectory, hash(reviewRunId));
	}

	async write(
		document: ReviewSourceDocument,
		signal: AbortSignal,
	): Promise<ReviewSourceReference> {
		signal.throwIfAborted();
		const bytes = Buffer.from(document.content);
		const storageHash = hash(bytes);
		const source = {
			...document.source,
			contentHash: document.source.contentHash ?? `sha256:${storageHash}`,
		};
		const artifact = ARTIFACT_SCHEMA.parse({ source, storageHash, sizeBytes: bytes.length });
		validateContentReference(artifact, bytes);
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		await this.atomicWrite(`${storageHash}.blob`, bytes, signal);
		await this.atomicWrite(`${referenceKey(source)}.json`, JSON.stringify(artifact), signal);
		await this.atomicWrite(`${identityKey(source)}.alias`, JSON.stringify(source), signal);
		return source;
	}

	async read(
		identity: ReviewSourceIdentity,
		signal: AbortSignal,
	): Promise<ReviewSourceDocument | null> {
		const artifact = await this.metadata(identity, signal);
		if (artifact === null) return null;
		const bytes = await readFile(join(this.directory, `${artifact.storageHash}.blob`), {
			signal,
		});
		if (bytes.length !== artifact.sizeBytes || hash(bytes) !== artifact.storageHash)
			throw new Error("Invalid source artifact content.");
		validateContentReference(artifact, bytes);
		return {
			source: artifact.source,
			content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
		};
	}

	async list(
		role: ReviewSourceIdentity["role"],
		signal: AbortSignal,
	): Promise<readonly ReviewSourceEntry[]> {
		const names = await this.fileNames();
		const entries: ReviewSourceEntry[] = [];
		for (const name of names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
			signal.throwIfAborted();
			const artifact = ARTIFACT_SCHEMA.parse(
				JSON.parse(
					await readFile(join(this.directory, name), { encoding: "utf8", signal }),
				),
			);
			if (`${referenceKey(artifact.source)}.json` !== name)
				throw new Error("Invalid source artifact metadata identity.");
			if (artifact.source.role === role)
				entries.push({ ...artifact.source, kind: "file", sizeBytes: artifact.sizeBytes });
		}
		return entries;
	}

	private async metadata(
		identity: ReviewSourceIdentity,
		signal: AbortSignal,
	): Promise<Artifact | null> {
		try {
			const source =
				identity.contentHash == null
					? REFERENCE_SCHEMA.parse(
							JSON.parse(
								await readFile(
									join(this.directory, `${identityKey(identity)}.alias`),
									{ encoding: "utf8", signal },
								),
							),
						)
					: identity;
			const artifact = ARTIFACT_SCHEMA.parse(
				JSON.parse(
					await readFile(join(this.directory, `${referenceKey(source)}.json`), {
						encoding: "utf8",
						signal,
					}),
				),
			);
			validateArtifactIdentity(artifact, source);
			return artifact;
		} catch (error) {
			if (isMissingFile(error)) return null;
			throw error;
		}
	}

	private async fileNames(): Promise<readonly string[]> {
		try {
			return await readdir(this.directory);
		} catch (error) {
			if (isMissingFile(error)) return [];
			throw error;
		}
	}

	private async atomicWrite(
		name: string,
		content: string | Uint8Array,
		signal: AbortSignal,
	): Promise<void> {
		const temporary = join(this.directory, `${name}.tmp-${randomUUID()}`);
		try {
			await writeFile(temporary, content, { mode: 0o600, signal });
			signal.throwIfAborted();
			await rename(temporary, join(this.directory, name));
		} finally {
			await rm(temporary, { force: true });
		}
	}
}

function identityKey(source: ReviewSourceIdentity): string {
	return hash(JSON.stringify([source.role, source.path]));
}
function referenceKey(source: ReviewSourceIdentity): string {
	return hash(JSON.stringify([source.role, source.path, source.contentHash]));
}
function validateArtifactIdentity(artifact: Artifact, source: ReviewSourceIdentity): void {
	if (referenceKey(artifact.source) !== referenceKey(source))
		throw new Error("Invalid source artifact identity.");
}
function validateContentReference(artifact: Artifact, bytes: Buffer): void {
	const expected = artifact.source.contentHash.startsWith("sha256:")
		? `sha256:${artifact.storageHash}`
		: `git:${createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")}`;
	if (artifact.source.contentHash !== expected)
		throw new Error("Invalid source artifact content reference.");
}
function hash(content: string | Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}
function isMissingFile(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
