import type { ServerResponse } from "node:http";

export function sendJson(response: ServerResponse, statusCode: number, body: object): void {
	response
		.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" })
		.end(JSON.stringify(body));
}
