"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
	createModel,
	type DashboardModelInput,
	type ModelMutationOutcome,
	selectModel,
	updateModel,
} from "../../lib/api-client";
import { readSession, readSessionToken } from "../../lib/session";

const USD_PER_MILLION_SCHEMA = z
	.string()
	.trim()
	.regex(/^\d+(?:\.\d{1,3})?$/)
	.transform((value) => Number(value) * 1_000)
	.refine(Number.isSafeInteger);
const MODEL_FORM_SCHEMA = z.object({
	displayName: z.string().trim().min(1).max(100),
	apiName: z
		.string()
		.trim()
		.regex(/^gemini-[a-z0-9.-]{1,120}$/),
	inputNanoUsdPerToken: USD_PER_MILLION_SCHEMA,
	cachedInputNanoUsdPerToken: USD_PER_MILLION_SCHEMA,
	outputNanoUsdPerToken: USD_PER_MILLION_SCHEMA,
	enabled: z.boolean(),
});

export async function createModelAction(formData: FormData): Promise<void> {
	const input = parseModelForm(formData);
	if (input === null) {
		redirectToModels("invalid");
	}

	const sessionToken = await requireAdminSession();
	redirectAfterMutation(await createModel(sessionToken, input));
}

export async function updateModelAction(id: string, formData: FormData): Promise<void> {
	const parsedId = z.string().uuid().safeParse(id);
	const input = parseModelForm(formData);
	if (!parsedId.success || input === null) {
		redirectToModels("invalid");
	}

	const sessionToken = await requireAdminSession();
	redirectAfterMutation(await updateModel(sessionToken, parsedId.data, input));
}

export async function setModelEnabledAction(id: string, enabled: boolean): Promise<void> {
	const parsedId = z.string().uuid().safeParse(id);
	if (!parsedId.success) {
		redirectToModels("invalid");
	}

	const sessionToken = await requireAdminSession();
	redirectAfterMutation(await updateModel(sessionToken, parsedId.data, { enabled }));
}

export async function selectModelAction(id: string): Promise<void> {
	const parsedId = z.string().uuid().safeParse(id);
	if (!parsedId.success) {
		redirectToModels("invalid");
	}

	const sessionToken = await requireAdminSession();
	redirectAfterMutation(await selectModel(sessionToken, parsedId.data));
}

function parseModelForm(formData: FormData): DashboardModelInput | null {
	const parsed = MODEL_FORM_SCHEMA.safeParse({
		displayName: formData.get("displayName"),
		apiName: formData.get("apiName"),
		inputNanoUsdPerToken: formData.get("inputUsdPerMillion"),
		cachedInputNanoUsdPerToken: formData.get("cachedInputUsdPerMillion"),
		outputNanoUsdPerToken: formData.get("outputUsdPerMillion"),
		enabled: formData.get("enabled") === "on",
	});
	return parsed.success ? parsed.data : null;
}

async function requireAdminSession(): Promise<string> {
	const [user, sessionToken] = await Promise.all([readSession(), readSessionToken()]);
	if (user === null || sessionToken === null) {
		redirect("/login");
	}
	if (user.role !== "admin") {
		redirectToModels("forbidden");
	}
	return sessionToken;
}

function redirectAfterMutation(outcome: ModelMutationOutcome): never {
	if (outcome === "unauthorized") {
		redirect("/login");
	}
	if (outcome !== "success") {
		redirectToModels(outcome);
	}

	revalidatePath("/dashboard/models");
	redirect("/dashboard/models?saved=1");
}

function redirectToModels(error: Exclude<ModelMutationOutcome, "success" | "unauthorized">): never {
	redirect(`/dashboard/models?error=${error}`);
}
