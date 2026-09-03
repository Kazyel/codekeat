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
	createGitHubConnectionReadController,
	GitHubAccessRepository,
	GitHubReviewInputService,
	GitHubReviewPublicationService,
	registerGitHubWebhookController,
	WebhookDeliveryRepository,
} from "#features/github";
import { createModelCatalogController, ModelCatalogRepository } from "../features/models/index.js";
import { GeminiReviewService } from "#integrations/gemini";
import {
	createReviewQualityController,
	createReviewReadController,
	createReviewUsageController,
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
	const db = createDatabaseConnection(environment.databasePath);
	try {
		migrateDatabase(db);

		/*
			Repositories persistindo os dados do dashboard, GitHub e revisão.
		*/
		const authRepository = new DashboardAuthRepository(db);
		const githubAccessRepository = new GitHubAccessRepository(db);
		const modelCatalogRepository = new ModelCatalogRepository(db);
		const webhookDeliveryRepository = new WebhookDeliveryRepository(db);
		const reviewReportRepository = new ReviewReportRepository(db);
		const reviewRunRepository = new ReviewRunRepository(db, reviewReportRepository);
		const reviewQueryRepository = new ReviewQueryRepository(db);

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
			app.log,
		);

		const model = new GeminiReviewService(
			environment.googleApiKey,
			new TakeatMcpTool(environment.takeatMcpUrl, takeatMcpAccessTokenService, app.log),
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
					modelRepository: modelCatalogRepository,
					runRepository: reviewRunRepository,
				}),
		});

		/*
			Endpoints de leitura de conexões GitHub, revisões, uso de tokens, modelos e autenticação do dashboard.
		*/
		options.addHandler(
			createGitHubConnectionReadController(
				githubAccessRepository,
				environment.allowedGithubAccounts,
				environment.dashboardApiToken,
			),
		);
		options.addHandler(
			createReviewReadController(reviewQueryRepository, environment.dashboardApiToken),
		);
		options.addHandler(
			createReviewUsageController(reviewQueryRepository, environment.dashboardApiToken),
		);
		options.addHandler(
			createReviewQualityController(reviewQueryRepository, environment.dashboardApiToken),
		);
		options.addHandler(
			createModelCatalogController(
				modelCatalogRepository,
				dashboardAuthenticator,
				environment.dashboardApiToken,
			),
		);
		options.addHandler(
			createDashboardAuthController(dashboardAuthenticator, environment.dashboardApiToken),
		);

		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}
