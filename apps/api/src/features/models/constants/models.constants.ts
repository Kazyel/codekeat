import {
	DASHBOARD_SESSION_TOKEN_MAXIMUM_LENGTH,
	DASHBOARD_SESSION_TOKEN_MINIMUM_LENGTH,
} from "#features/auth";
import z from "zod";

export const MODELS_PATH = "/api/v1/models";
export const MAXIMUM_MODEL_REQUEST_BYTES = 8_192;

export const MODEL_ID_SCHEMA = z.string().uuid();
export const PRICE_SCHEMA = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const MODEL_FIELDS = {
	displayName: z.string().trim().min(1).max(100),
	apiName: z
		.string()
		.trim()
		.regex(/^gemini-[a-z0-9.-]{1,120}$/),
	inputNanoUsdPerToken: PRICE_SCHEMA,
	cachedInputNanoUsdPerToken: PRICE_SCHEMA,
	outputNanoUsdPerToken: PRICE_SCHEMA,
	enabled: z.boolean(),
};

export const CREATE_MODEL_SCHEMA = z.object(MODEL_FIELDS).strict();

export const UPDATE_MODEL_SCHEMA = z
	.object({
		displayName: MODEL_FIELDS.displayName.optional(),
		apiName: MODEL_FIELDS.apiName.optional(),
		inputNanoUsdPerToken: PRICE_SCHEMA.optional(),
		cachedInputNanoUsdPerToken: PRICE_SCHEMA.optional(),
		outputNanoUsdPerToken: PRICE_SCHEMA.optional(),
		enabled: MODEL_FIELDS.enabled.optional(),
	})
	.strict()
	.refine((input) => Object.keys(input).length > 0);

export const SESSION_TOKEN_SCHEMA = z
	.string()
	.min(DASHBOARD_SESSION_TOKEN_MINIMUM_LENGTH)
	.max(DASHBOARD_SESSION_TOKEN_MAXIMUM_LENGTH);
