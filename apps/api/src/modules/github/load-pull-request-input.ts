import type { RunnableReviewRun } from "@codekeat/database";
import parseDiff, { type Change, type Chunk, type File } from "parse-diff";
import type { Probot } from "probot";
import type {
  ReviewInputChunk,
  ReviewInputLoadResult,
  ReviewInputSource,
} from "../review/review-input.js";

export const maximumReviewChunkLength = 100_000;
const maximumPullRequestFiles = 3_000;

interface DiffSection {
  readonly changedLines: ReadonlyMap<string, ReadonlySet<number>>;
  readonly diff: string;
}

export class GitHubReviewInputSource implements ReviewInputSource {
  constructor(private readonly app: Probot) {}

  async load(run: RunnableReviewRun): Promise<ReviewInputLoadResult> {
    try {
      const octokit = await this.app.auth(run.githubInstallationId);

      const pullRequest = await octokit.rest.pulls.get({
        owner: run.repositoryOwner,
        repo: run.repositoryName,
        pull_number: run.pullRequestNumber,
      });

      if (pullRequest.data.head.sha !== run.headSha) {
        return { kind: "ignored", ignoreReason: "superseded_head_sha" };
      }

      if (pullRequest.data.changed_files > maximumPullRequestFiles) {
        return { kind: "failed", errorCode: "github_diff_file_limit_exceeded" };
      }

      const diffResponse = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: run.repositoryOwner,
        repo: run.repositoryName,
        pull_number: run.pullRequestNumber,
        headers: { accept: "application/vnd.github.diff" },
      });

      if (typeof diffResponse.data !== "string") {
        return { kind: "failed", errorCode: "github_diff_unavailable" };
      }

      return {
        kind: "ready",
        input: {
          body: pullRequest.data.body,
          chunks: createReviewInputChunks(diffResponse.data),
          headSha: run.headSha,
          pullRequestNumber: run.pullRequestNumber,
          repositoryFullName: run.repositoryFullName,
          reviewRunId: run.id,
          title: pullRequest.data.title,
        },
      };
    } catch {
      return { kind: "failed", errorCode: "github_diff_unavailable" };
    }
  }
}

export function createReviewInputChunks(diff: string): readonly ReviewInputChunk[] {
  const sections = parseDiff(diff).flatMap(createFileSections);
  return packSections(sections).map((section, index, packedSections) => ({
    changedLines: section.changedLines,
    diff: section.diff,
    index: index + 1,
    total: packedSections.length,
  }));
}

function createFileSections(file: File): readonly DiffSection[] {
  const path = resolveFilePath(file);
  if (path === null) {
    return [];
  }
  return file.chunks.flatMap((chunk) => splitChunk(path, chunk));
}

function resolveFilePath(file: File): string | null {
  const path = file.to ?? file.from;
  if (path === undefined || path === "/dev/null") {
    return null;
  }
  return path;
}

function splitChunk(path: string, chunk: Chunk): readonly DiffSection[] {
  const prefix = createFileHeader(path, chunk.content);
  const sections: DiffSection[] = [];
  let section = createSection(prefix);

  for (const change of chunk.changes) {
    const result = appendChangeWithinLimit(section, prefix, path, change);
    sections.push(...result.completedSections);
    section = result.section;
  }

  return section.diff === prefix ? [] : [...sections, section];
}

function createFileHeader(path: string, hunkHeader: string): string {
  return (
    [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, hunkHeader].join("\n") +
    "\n"
  );
}

function createSection(diff: string): DiffSection {
  return { changedLines: new Map(), diff };
}

function wouldExceedLimit(diff: string, line: string): boolean {
  return diff.length > 0 && diff.length + line.length > maximumReviewChunkLength;
}

function appendChangeWithinLimit(
  initialSection: DiffSection,
  prefix: string,
  path: string,
  change: Change,
): { readonly completedSections: readonly DiffSection[]; readonly section: DiffSection } {
  const completedSections: DiffSection[] = [];
  const line = `${change.content}\n`;
  let section = initialSection;
  let remainingLine = line;

  while (remainingLine.length > 0) {
    const capacity = maximumReviewChunkLength - section.diff.length;
    if (capacity === 0) {
      completedSections.push(section);
      section = createSection(prefix);
      continue;
    }

    const fragment = remainingLine.slice(0, capacity);
    section = appendChange(section, path, change, fragment);
    remainingLine = remainingLine.slice(fragment.length);
  }

  return { completedSections, section };
}

function appendChange(
  section: DiffSection,
  path: string,
  change: Change,
  fragment: string,
): DiffSection {
  const changedLines = new Map(section.changedLines);
  if (change.type === "add") {
    const existingLines = changedLines.get(path) ?? new Set<number>();
    changedLines.set(path, new Set([...existingLines, change.ln]));
  }
  return { changedLines, diff: section.diff + fragment };
}

function packSections(sections: readonly DiffSection[]): readonly DiffSection[] {
  const chunks: DiffSection[] = [];
  let chunk = createSection("");

  for (const section of sections) {
    if (wouldExceedLimit(chunk.diff, section.diff)) {
      chunks.push(chunk);
      chunk = createSection("");
    }
    chunk = mergeSections(chunk, section);
  }

  return chunk.diff === "" ? chunks : [...chunks, chunk];
}

function mergeSections(first: DiffSection, second: DiffSection): DiffSection {
  const changedLines = new Map(first.changedLines);
  for (const [path, lines] of second.changedLines) {
    changedLines.set(path, new Set([...(changedLines.get(path) ?? []), ...lines]));
  }
  return { changedLines, diff: first.diff + second.diff };
}
