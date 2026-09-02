import {
	createDatabaseConnection,
	type DatabaseConnection,
	migrateDatabase,
} from "@codekeat/database";

import { DashboardAuthRepository } from "#features/auth";
import { GitHubAccessRepository, WebhookDeliveryRepository } from "#features/github";
import {
	ReviewQueryRepository,
	ReviewReportRepository,
	ReviewRunRepository,
} from "#features/review";

export interface TestDatabase {
	readonly connection: DatabaseConnection;
	readonly authRepository: DashboardAuthRepository;
	readonly githubAccessRepository: GitHubAccessRepository;
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

	return {
		connection,
		authRepository: new DashboardAuthRepository(connection),
		githubAccessRepository: new GitHubAccessRepository(connection),
		webhookDeliveryRepository: new WebhookDeliveryRepository(connection),
		reviewQueryRepository: new ReviewQueryRepository(connection),
		reviewReportRepository,
		reviewRunRepository: new ReviewRunRepository(connection, reviewReportRepository),
		close(): void {
			connection.close();
		},
	};
}
