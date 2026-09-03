import { parse } from "yaml";
import { z } from "zod";
import {
	DEFAULT_REPOSITORY_POLICY,
	INVALID_REPOSITORY_POLICY_WARNING,
} from "../constants/repository-policy.constants.js";
import type { ResolvedRepositoryPolicy } from "../types/repository-policy.types.js";

const REPOSITORY_POLICY_SCHEMA = z
	.object({
		version: z.literal(1),
		enabled: z.boolean().default(true),
	})
	.strict();

export function resolveRepositoryPolicy(source: string): ResolvedRepositoryPolicy {
	try {
		const result = REPOSITORY_POLICY_SCHEMA.safeParse(parse(source));
		if (result.success) {
			return { policy: result.data, source: "repository", warningCode: null };
		}
	} catch {
		return invalidPolicyFallback();
	}

	return invalidPolicyFallback();
}

export function defaultRepositoryPolicy(): ResolvedRepositoryPolicy {
	return { policy: DEFAULT_REPOSITORY_POLICY, source: "default", warningCode: null };
}

function invalidPolicyFallback(): ResolvedRepositoryPolicy {
	return {
		policy: DEFAULT_REPOSITORY_POLICY,
		source: "default",
		warningCode: INVALID_REPOSITORY_POLICY_WARNING,
	};
}
