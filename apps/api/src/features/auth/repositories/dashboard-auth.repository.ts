import { dashboardSessions, dashboardUsers, type DatabaseConnection } from "@codekeat/database";
import { and, eq, gt } from "drizzle-orm";
import { currentTimestamp } from "#shared/database";

import type {
	AuthenticatedDashboardUser,
	DashboardSessionInput,
	DashboardUserCredentials,
	DashboardUserInput,
} from "../types/dashboard-auth.types.js";

export class DashboardAuthRepository {
	constructor(private readonly connection: DatabaseConnection) {}

	createDashboardUserIfMissing(input: DashboardUserInput): void {
		const now = currentTimestamp();
		this.connection.db
			.insert(dashboardUsers)
			.values({ ...input, createdAt: now, updatedAt: now })
			.onConflictDoNothing({ target: dashboardUsers.email })
			.run();
	}

	findDashboardUserCredentials(email: string): DashboardUserCredentials | null {
		const user = this.connection.db
			.select({
				id: dashboardUsers.id,
				email: dashboardUsers.email,
				passwordHash: dashboardUsers.passwordHash,
				role: dashboardUsers.role,
			})
			.from(dashboardUsers)
			.where(eq(dashboardUsers.email, email))
			.get();

		return user ?? null;
	}

	createDashboardSession(input: DashboardSessionInput): void {
		this.connection.db
			.insert(dashboardSessions)
			.values({ ...input, createdAt: currentTimestamp() })
			.run();
	}

	findAuthenticatedDashboardUser(
		tokenHash: string,
		now: string,
	): AuthenticatedDashboardUser | null {
		const user = this.connection.db
			.select({
				id: dashboardUsers.id,
				email: dashboardUsers.email,
				role: dashboardUsers.role,
			})
			.from(dashboardSessions)
			.innerJoin(dashboardUsers, eq(dashboardSessions.userId, dashboardUsers.id))
			.where(
				and(
					eq(dashboardSessions.tokenHash, tokenHash),
					gt(dashboardSessions.expiresAt, now),
				),
			)
			.get();

		return user ?? null;
	}

	deleteDashboardSession(tokenHash: string): void {
		this.connection.db
			.delete(dashboardSessions)
			.where(eq(dashboardSessions.tokenHash, tokenHash))
			.run();
	}
}
