import { parse } from "yaml";
import { z } from "zod";

const repositoryPolicySchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean().default(true),
  })
  .strict();

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

const defaultPolicy: RepositoryPolicy = { version: 1, enabled: true };

export function resolveRepositoryPolicy(source: string): ResolvedRepositoryPolicy {
  try {
    const result = repositoryPolicySchema.safeParse(parse(source));
    if (result.success) {
      return { policy: result.data, source: "repository", warningCode: null };
    }
  } catch {
    return invalidPolicyFallback();
  }

  return invalidPolicyFallback();
}

export function defaultRepositoryPolicy(): ResolvedRepositoryPolicy {
  return { policy: defaultPolicy, source: "default", warningCode: null };
}

function invalidPolicyFallback(): ResolvedRepositoryPolicy {
  return {
    policy: defaultPolicy,
    source: "default",
    warningCode: "invalid_repository_policy",
  };
}
