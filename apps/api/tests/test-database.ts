import {
	createDatabaseConnection,
	type DatabaseConnection,
	migrateDatabase,
} from "@codekeat/database";

import { DashboardAuthRepository } from "#features/auth";
import { GitHubAccessRepository, WebhookDeliveryRepository } from "#features/github";
import { ModelCatalogRepository, type ReviewModelConfiguration } from "#features/models";
import {
	ReviewQueryRepository,
	ReviewReportRepository,
	ReviewRunRepository,
} from "#features/review";

export interface TestDatabase {
	readonly connection: DatabaseConnection;
	readonly authRepository: DashboardAuthRepository;
	readonly githubAccessRepository: GitHubAccessRepository;
	readonly modelCatalogRepository: ModelCatalogRepository;
	readonly selectedModel: ReviewModelConfiguration;
	readonly webhookDeliveryRepository: WebhookDeliveryRepository;
	readonly reviewQueryRepository: ReviewQueryRepository;
	readonly reviewReportRepository: ReviewReportRepository;
	readonly reviewRunRepository: ReviewRunRepository;
	close(): void;
}

export function createTestDatabase(): TestDatabase {
	const connection = createDatabaseConnection(":memory:");
	migrateDatabase(connection);
	const reviewReportRepository = new ReviewReportRepository(connection);
	const modelCatalogRepository = new ModelCatalogRepository(connection);
	const selectedModel = modelCatalogRepository.findSelectedModel();
	if (selectedModel === null) {
		throw new Error("Test database is missing its selected model.");
	}

	return {
		connection,
		authRepository: new DashboardAuthRepository(connection),
		githubAccessRepository: new GitHubAccessRepository(connection),
		modelCatalogRepository,
		selectedModel,
		webhookDeliveryRepository: new WebhookDeliveryRepository(connection),
		reviewQueryRepository: new ReviewQueryRepository(connection),
		reviewReportRepository,
		reviewRunRepository: new ReviewRunRepository(connection, reviewReportRepository),
		close(): void {
			connection.close();
		},
	};
}
