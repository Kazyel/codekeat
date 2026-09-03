import type { RepositoryPolicy } from "../types/repository-policy.types.js";

export const DEFAULT_REPOSITORY_POLICY: RepositoryPolicy = { version: 1, enabled: true };
export const INVALID_REPOSITORY_POLICY_WARNING = "invalid_repository_policy";
