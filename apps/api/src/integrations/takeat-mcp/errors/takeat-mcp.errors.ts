export class TakeatMcpUnavailableError extends Error {
	constructor() {
		super("The Takeat MCP server is unavailable.");
	}
}

export class TakeatMcpToolCallRejectedError extends Error {
	constructor() {
		super("The Takeat MCP tool call is not allowed.");
	}
}
