import type { IncomingMessage, ServerResponse } from "node:http";

import {
	hasValidBearerToken,
	HTTP_STATUS_METHOD_NOT_ALLOWED,
	HTTP_STATUS_OK,
	HTTP_STATUS_UNAUTHORIZED,
	sendJson,
} from "#shared/http";

import { GITHUB_CONNECTIONS_PATH } from "../constants/github.constants.js";
import type { GitHubAccessRepository } from "../repositories/github-access.repository.js";
import { isAllowedGithubAccount } from "../utils/github-account.util.js";

type HttpHandler = (request: IncomingMessage, response: ServerResponse) => boolean;

export function createGitHubConnectionReadController(
	repository: GitHubAccessRepository,
	allowedAccounts: ReadonlySet<string>,
	dashboardApiToken: string,
): HttpHandler {
	return (request, response) => {
		const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
		if (pathname !== GITHUB_CONNECTIONS_PATH) {
			return false;
		}

		if (!hasValidBearerToken(request, dashboardApiToken)) {
			sendJson(response, HTTP_STATUS_UNAUTHORIZED, { error: "unauthorized" });
			return true;
		}

		if (request.method !== "GET") {
			sendJson(response, HTTP_STATUS_METHOD_NOT_ALLOWED, { error: "method_not_allowed" });
			return true;
		}

		sendJson(response, HTTP_STATUS_OK, {
			connections: repository.listInstallationSummaries().map((installation) => ({
				githubInstallationId: installation.githubInstallationId,
				accountLogin: installation.accountLogin,
				status: installation.status,
				allowedByConfiguration: isAllowedGithubAccount(
					installation.accountLogin,
					allowedAccounts,
				),
				updatedAt: installation.updatedAt,
				repositories: installation.repositories,
			})),
		});
		return true;
	};
}
