export type ReviewSourceRole = "head" | "before" | "pull_request" | "investigation";

export interface ReviewSourceIdentity {
	readonly role: ReviewSourceRole;
	readonly path: string;
	readonly contentHash?: string | null;
}

export interface ReviewSourceRevision {
	readonly role: ReviewSourceRole;
	readonly repositoryFullName: string | null;
	readonly revision: string;
}

export interface ReviewSourceReference extends ReviewSourceIdentity, ReviewSourceRevision {
	readonly contentHash: string | null;
}

export interface ReviewSourceEntry extends ReviewSourceReference {
	readonly kind: "file" | "symlink" | "submodule";
	readonly sizeBytes: number | null;
}

export type ReviewSourceFailureReason =
	| "repository_unavailable"
	| "revision_unavailable"
	| "request_failed"
	| "invalid_response"
	| "invalid_request"
	| "unsupported_file";

export interface ReviewSourceUnavailable {
	readonly kind: "unavailable";
	readonly reason: ReviewSourceFailureReason;
}

export interface ReviewSourceListRequest {
	readonly role: ReviewSourceRole;
	readonly prefix: string;
	readonly cursor: string | null;
	readonly limit: number;
}

export interface ReviewSourceListPage {
	readonly kind: "page";
	readonly entries: readonly ReviewSourceEntry[];
	readonly totalEntries: number;
	readonly nextCursor: string | null;
}

/** Columns use UTF16 offsets, with an exclusive end. A range never cuts data implicitly. */
export type ReviewSourceRange =
	| { readonly kind: "lines"; readonly startLine: number; readonly lineCount: number }
	| {
			readonly kind: "columns";
			readonly line: number;
			readonly startColumn: number;
			readonly columnCount: number;
	  };

export interface ReviewSourceReadRequest {
	readonly source: ReviewSourceIdentity;
	readonly range: ReviewSourceRange;
}

export interface ReviewSourceReadPage {
	readonly kind: "loaded";
	readonly source: ReviewSourceReference;
	readonly content: string;
	readonly totalLines: number;
	readonly startLine: number;
	readonly endLine: number;
	readonly startColumn: number;
	readonly endColumn: number;
	readonly nextRange: ReviewSourceRange | null;
}

export type ReviewSourceReadResult =
	| ReviewSourceReadPage
	| { readonly kind: "missing"; readonly source: ReviewSourceIdentity }
	| (ReviewSourceUnavailable & { readonly source: ReviewSourceIdentity });

export interface ReviewSourceSearchRequest extends ReviewSourceListRequest {
	readonly mode: "path" | "content";
	readonly query: string;
	readonly scanLimit: number;
}

export interface ReviewSourceSearchMatch {
	readonly source: ReviewSourceReference;
	readonly line: number;
	readonly column: number;
	readonly length: number;
}

export interface ReviewSourceSearchPage {
	readonly kind: "page";
	readonly matches: readonly ReviewSourceSearchMatch[];
	readonly scannedSources: number;
	readonly totalSources: number;
	readonly nextCursor: string | null;
	readonly unavailable: readonly (ReviewSourceUnavailable & {
		readonly source: ReviewSourceIdentity;
	})[];
}

export interface ReviewSourceRelatedRequest {
	readonly source: ReviewSourceIdentity;
	readonly cursor: string | null;
	readonly limit: number;
}

export interface ReviewSourceCatalog {
	readonly revisions: readonly ReviewSourceRevision[];
	list(
		request: ReviewSourceListRequest,
		signal: AbortSignal,
	): Promise<ReviewSourceListPage | ReviewSourceUnavailable>;
	read(request: ReviewSourceReadRequest, signal: AbortSignal): Promise<ReviewSourceReadResult>;
	search(
		request: ReviewSourceSearchRequest,
		signal: AbortSignal,
	): Promise<ReviewSourceSearchPage | ReviewSourceUnavailable>;
	related(
		request: ReviewSourceRelatedRequest,
		signal: AbortSignal,
	): Promise<ReviewSourceListPage | ReviewSourceUnavailable>;
	recordInvestigation(
		tool: string,
		argumentsJson: string,
		responseJson: string,
		signal: AbortSignal,
	): Promise<ReviewSourceReference>;
}

export interface ReviewSourceDocument {
	readonly source: ReviewSourceReference;
	readonly content: string;
}
