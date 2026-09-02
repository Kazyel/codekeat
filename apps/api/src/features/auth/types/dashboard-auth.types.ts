export type DashboardUserRole = "admin" | "member";

export interface DashboardUserInput {
	readonly id: string;
	readonly email: string;
	readonly passwordHash: string;
	readonly role: DashboardUserRole;
}

export interface DashboardSessionInput {
	readonly id: string;
	readonly userId: string;
	readonly tokenHash: string;
	readonly expiresAt: string;
}

export interface DashboardUserCredentials {
	readonly id: string;
	readonly email: string;
	readonly passwordHash: string;
	readonly role: DashboardUserRole;
}

export interface AuthenticatedDashboardUser {
	readonly id: string;
	readonly email: string;
	readonly role: DashboardUserRole;
}

export interface DashboardCredentials {
	readonly email: string;
	readonly password: string;
}

export type InitialDashboardAdmin = DashboardCredentials;

export interface DashboardSession {
	readonly token: string;
	readonly user: AuthenticatedDashboardUser;
}
