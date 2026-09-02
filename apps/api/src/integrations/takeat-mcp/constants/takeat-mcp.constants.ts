export const TAKEAT_MCP_REQUEST_TIMEOUT_MS = 10_000;
export const MAXIMUM_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1_000;
export const MILLISECONDS_PER_SECOND = 1_000;
export const TOKEN_REFRESH_LIFETIME_DIVISOR = 5;

export const ALLOWED_TAKEAT_MCP_TOOL_NAMES: Readonly<Record<string, true>> = {
	get_commit: true,
	get_commit_diff: true,
	list_repos: true,
	read_file: true,
	search_code: true,
	search_commits: true,
};
