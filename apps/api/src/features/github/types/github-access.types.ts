export type InstallationStatus = "active" | "suspended" | "deleted";
export type RepositoryStatus = "active" | "removed";

export interface GitHubRepositoryAccessSummary {
	readonly githubRepositoryId: number;
	readonly fullName: string;
	readonly defaultBranch: string | null;
	readonly status: RepositoryStatus;
	readonly updatedAt: string;
}

export interface GitHubInstallationSummary {
	readonly githubInstallationId: number;
	readonly accountLogin: string;
	readonly status: InstallationStatus;
	readonly updatedAt: string;
	readonly repositories: readonly GitHubRepositoryAccessSummary[];
}

export interface InstallationInput {
	readonly githubInstallationId: number;
	readonly accountLogin: string;
	readonly status: InstallationStatus;
}

export interface RepositoryInput {
	readonly githubRepositoryId: number;
	readonly installationId: number;
	readonly ownerLogin: string;
	readonly name: string;
	readonly defaultBranch: string;
	readonly status: RepositoryStatus;
}

export interface StoredInstallation {
	readonly status: InstallationStatus;
}

export interface StoredRepository {
	readonly defaultBranch: string;
	readonly status: RepositoryStatus;
}
