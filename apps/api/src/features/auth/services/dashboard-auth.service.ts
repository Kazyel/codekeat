import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	DASHBOARD_SESSION_DURATION_MS,
	DASHBOARD_SESSION_TOKEN_BYTES,
} from "../constants/dashboard-auth.constants.js";
import type { DashboardAuthRepository } from "../repositories/dashboard-auth.repository.js";
import type {
	AuthenticatedDashboardUser,
	DashboardCredentials,
	DashboardSession,
	DashboardUserCredentials,
	InitialDashboardAdmin,
} from "../types/dashboard-auth.types.js";
import type { Argon2PasswordService } from "./argon2-password.service.js";

export class DashboardAuthService {
	constructor(
		private readonly repository: DashboardAuthRepository,
		private readonly passwordService: Argon2PasswordService,
	) {}

	async provisionInitialAdmin(admin: InitialDashboardAdmin): Promise<void> {
		if (this.repository.findDashboardUserCredentials(admin.email) !== null) {
			return;
		}

		const passwordHash = await this.passwordService.hash(admin.password);
		this.repository.createDashboardUserIfMissing({
			id: randomUUID(),
			email: admin.email,
			passwordHash,
			role: "admin",
		});
	}

	async createSession(credentials: DashboardCredentials): Promise<DashboardSession | null> {
		const user = this.repository.findDashboardUserCredentials(credentials.email);
		if (
			user === null ||
			!(await passwordMatches(user, credentials.password, this.passwordService))
		) {
			return null;
		}

		const token = randomBytes(DASHBOARD_SESSION_TOKEN_BYTES).toString("base64url");
		this.repository.createDashboardSession({
			id: randomUUID(),
			userId: user.id,
			tokenHash: hashSessionToken(token),
			expiresAt: sessionExpiry(),
		});

		return { token, user: withoutPasswordHash(user) };
	}

	readSession(token: string): AuthenticatedDashboardUser | null {
		return this.repository.findAuthenticatedDashboardUser(
			hashSessionToken(token),
			new Date().toISOString(),
		);
	}

	deleteSession(token: string): void {
		this.repository.deleteDashboardSession(hashSessionToken(token));
	}
}

async function passwordMatches(
	user: DashboardUserCredentials,
	password: string,
	passwordService: Argon2PasswordService,
): Promise<boolean> {
	return passwordService.verify(user.passwordHash, password);
}

function withoutPasswordHash(user: DashboardUserCredentials): AuthenticatedDashboardUser {
	return { id: user.id, email: user.email, role: user.role };
}

function hashSessionToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function sessionExpiry(): string {
	return new Date(Date.now() + DASHBOARD_SESSION_DURATION_MS).toISOString();
}
