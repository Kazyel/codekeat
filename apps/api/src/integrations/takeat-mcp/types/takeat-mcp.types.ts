import type { z } from "zod";

export type McpJsonObject = Record<string, z.JSONType>;

export interface TakeatMcpToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: McpJsonObject & { type: "object" };
}

export interface TakeatMcpContextSource {
	listTools(): Promise<readonly TakeatMcpToolDefinition[]>;
	callTool(name: string, args: McpJsonObject): Promise<McpJsonObject>;
}
