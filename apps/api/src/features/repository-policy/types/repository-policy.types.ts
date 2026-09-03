export interface RepositoryPolicy {
	readonly version: 1;
	readonly enabled: boolean;
}

export type PolicySource = "default" | "repository";
export type PolicyWarningCode = "invalid_repository_policy";

export interface ResolvedRepositoryPolicy {
	readonly policy: RepositoryPolicy;
	readonly source: PolicySource;
	readonly warningCode: PolicyWarningCode | null;
}

export interface RepositoryPolicyLocation {
	readonly repositoryOwner: string;
	readonly repositoryName: string;
	readonly repositoryDefaultBranch: string;
}
