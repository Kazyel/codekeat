import {
	createDatabaseConnection,
	type DatabaseConnection,
	migrateDatabase,
} from "@codekeat/database";
import type { ApplicationFunctionOptions, Probot } from "probot";

import { requestReviewFromGithub } from "#core/workflows/request-review-from-github";
import {
	Argon2PasswordService,
	createDashboardAuthController,
	DashboardAuthRepository,
	DashboardAuthService,
} from "#features/auth";
import {
	GitHubAccessRepository,
	GitHubReviewInputService,
	GitHubReviewPublicationService,
	registerGitHubWebhookController,
	WebhookDeliveryRepository,
} from "#features/github";
import { GeminiReviewService } from "#integrations/gemini";
import {
	createReviewReadController,
	ReviewQueryRepository,
	ReviewQueueService,
	ReviewReportPublisherService,
	ReviewReportRepository,
	ReviewRunProcessorService,
	type ReviewRunProcessorTask,
	ReviewRunRepository,
} from "#features/review";
import { TakeatMcpAccessTokenService, TakeatMcpTool } from "#integrations/takeat-mcp";
import type { ApplicationEnvironment } from "./environment.js";

export async function configureApplication(
	app: Probot,
	environment: ApplicationEnvironment,
	options: ApplicationFunctionOptions,
): Promise<DatabaseConnection> {
	const connection = createDatabaseConnection(environment.databasePath);
	try {
		migrateDatabase(connection);

		/*
			Repositories persistindo os dados do dashboard, GitHub e revisão.
		*/
		const authRepository = new DashboardAuthRepository(connection);
		const githubAccessRepository = new GitHubAccessRepository(connection);
		const webhookDeliveryRepository = new WebhookDeliveryRepository(connection);
		const reviewReportRepository = new ReviewReportRepository(connection);
		const reviewRunRepository = new ReviewRunRepository(connection, reviewReportRepository);
		const reviewQueryRepository = new ReviewQueryRepository(connection);

		/*
			Autenticação e provisionamento do administrador inicial.
		*/
		const dashboardAuthenticator = new DashboardAuthService(
			authRepository,
			new Argon2PasswordService(),
		);
		await dashboardAuthenticator.provisionInitialAdmin({
			email: environment.initialAdminEmail,
			password: environment.initialAdminPassword,
		});

		/*
			Serviço de token para a API do Takeat MCP e modelo de revisão Gemini.
		*/
		const takeatMcpAccessTokenService = new TakeatMcpAccessTokenService(
			environment.takeatMcpTokenUrl,
			environment.takeatMcpClientId,
			environment.takeatMcpClientSecret,
		);
		const model = new GeminiReviewService(
			environment.googleApiKey,
			environment.geminiModel,
			new TakeatMcpTool(environment.takeatMcpUrl, takeatMcpAccessTokenService),
			app.log,
		);

		/*
			Publicador de relatórios de revisão e processador de execução de revisão.
		*/
		const publisher = new ReviewReportPublisherService(
			reviewReportRepository,
			new GitHubReviewPublicationService(app),
			app.log,
		);
		let processor: ReviewRunProcessorService;
		const reviewTask: ReviewRunProcessorTask = {
			async process(reviewRunId: string): Promise<void> {
				await processor.process(reviewRunId);
			},
		};

		/*
			Fila de trabalho de revisão local.
		*/
		const queue = new ReviewQueueService(reviewTask, publisher, app.log);
		processor = new ReviewRunProcessorService(
			reviewRunRepository,
			new GitHubReviewInputService(app),
			model,
			queue,
			app.log,
		);

		/*
			Registro de webhooks para solicitações de revisão.
		*/
		registerGitHubWebhookController(app, {
			accessRepository: githubAccessRepository,
			deliveryRepository: webhookDeliveryRepository,
			allowedAccounts: environment.allowedGithubAccounts,
			requestReview: (event, policyService) =>
				requestReviewFromGithub(event, {
					accessRepository: githubAccessRepository,
					allowedAccounts: environment.allowedGithubAccounts,
					deliveryRepository: webhookDeliveryRepository,
					policyService,
					queue,
					reportRepository: reviewReportRepository,
					runRepository: reviewRunRepository,
				}),
		});

		/*
			API de leitura de revisões e autenticação do dashboard.
		*/
		options.addHandler(
			createReviewReadController(reviewQueryRepository, environment.dashboardApiToken),
		);
		options.addHandler(
			createDashboardAuthController(dashboardAuthenticator, environment.dashboardApiToken),
		);

		return connection;
	} catch (error) {
		connection.close();
		throw error;
	}
}
