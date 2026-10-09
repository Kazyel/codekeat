import {
	JSONParseError,
	NoObjectGeneratedError,
	TypeValidationError,
	type FinishReason,
	type GenerateTextStepEndEvent,
	type GenerateTextStepStartEvent,
	type ModelMessage,
	type ToolSet,
} from "ai";
import { Effect } from "effect";

import {
	ReviewConclusionValidationError,
	type ReviewConclusionValidationFailure,
} from "#features/review";

export type ReviewResponseRejection =
	| Exclude<ReviewConclusionValidationFailure, { readonly code: "evidence_receipt_invalid" }>
	| { readonly code: "invalid_json" | "schema_invalid" };

export interface ReviewCapturedResponse {
	readonly messages: readonly ModelMessage[];
	readonly finishReason: FinishReason;
	readonly text: string;
}

/** Retains the effective SDK transcript, including compacted tools and provider signatures. */
export class ReviewResponseCapture {
	private request: Pick<
		GenerateTextStepStartEvent<ToolSet>,
		"callId" | "stepNumber" | "messages"
	> | null = null;
	private response: ReviewCapturedResponse | null = null;

	started(event: GenerateTextStepStartEvent<ToolSet>): void {
		this.request = {
			callId: event.callId,
			stepNumber: event.stepNumber,
			messages: [...event.messages],
		};
		this.response = null;
	}

	ended(event: GenerateTextStepEndEvent<ToolSet>): void {
		const request = this.request;
		if (request === null) return;
		if (request.callId !== event.callId || request.stepNumber !== event.stepNumber) return;
		this.response = {
			messages: [...request.messages, ...event.response.messages],
			finishReason: event.finishReason,
			text: event.text,
		};
	}

	snapshot(): ReviewCapturedResponse | null {
		return this.response;
	}

	stepCount(): number {
		return this.request === null ? 0 : this.request.stepNumber + 1;
	}
}

export interface ReviewResponseAttempt {
	readonly capture: ReviewResponseCapture;
	readonly repair: {
		readonly messages: ModelMessage[];
		readonly stepOffset: number;
		readonly retrievalRounds: 2;
	} | null;
}

interface ReviewResponseRecoveryOptions<T> {
	readonly request: (attempt: ReviewResponseAttempt) => Effect.Effect<T, Error>;
	readonly rejected: (
		rejection: ReviewResponseRejection,
		response: ReviewCapturedResponse | null,
		attempt: 1 | 2,
	) => Effect.Effect<void, Error>;
}

/** One bounded continuation; transport retries remain owned by the SDK/provider. */
export function recoverReviewResponse<T>(
	options: ReviewResponseRecoveryOptions<T>,
): Effect.Effect<T, Error> {
	const initial: ReviewResponseAttempt = { capture: new ReviewResponseCapture(), repair: null };
	return options
		.request(initial)
		.pipe(Effect.catch((error) => recoverInitialResponse(options, initial, error)));
}

function recoverInitialResponse<T>(
	options: ReviewResponseRecoveryOptions<T>,
	initial: ReviewResponseAttempt,
	error: Error,
): Effect.Effect<T, Error> {
	const rejection = responseRejection(error);
	if (rejection === null) return Effect.fail(error);
	const response = initial.capture.snapshot();
	return Effect.gen(function* () {
		yield* options.rejected(rejection, response, 1);
		if (!repairableResponse(response)) return yield* Effect.fail(error);
		const repair: ReviewResponseAttempt = {
			capture: new ReviewResponseCapture(),
			repair: {
				messages: [...response.messages, { role: "user", content: correction(rejection) }],
				stepOffset: initial.capture.stepCount(),
				retrievalRounds: 2,
			},
		};
		return yield* options
			.request(repair)
			.pipe(Effect.catch((failure) => rejectRepair(options, repair, failure)));
	});
}

function rejectRepair<T>(
	options: ReviewResponseRecoveryOptions<T>,
	attempt: ReviewResponseAttempt,
	error: Error,
): Effect.Effect<T, Error> {
	const rejection = responseRejection(error);
	if (rejection === null) return Effect.fail(error);
	return options
		.rejected(rejection, attempt.capture.snapshot(), 2)
		.pipe(Effect.andThen(Effect.fail(error)));
}

function repairableResponse(
	response: ReviewCapturedResponse | null,
): response is ReviewCapturedResponse {
	return response !== null && response.finishReason === "stop" && response.text.trim().length > 0;
}

function responseRejection(error: Error): ReviewResponseRejection | null {
	if (error instanceof ReviewConclusionValidationError) {
		return error.failure.code === "evidence_receipt_invalid" ? null : error.failure;
	}
	if (NoObjectGeneratedError.isInstance(error)) return outputRejection(error.cause);
	return outputRejection(error);
}

function outputRejection(error: unknown): ReviewResponseRejection | null {
	if (JSONParseError.isInstance(error)) return { code: "invalid_json" };
	if (TypeValidationError.isInstance(error)) return { code: "schema_invalid" };
	return null;
}

function correction(rejection: ReviewResponseRejection): string {
	return [
		"A resposta anterior foi rejeitada pela validação do host. Corrija a conclusão e os findings usando o mesmo contexto e as fontes reais. Falha: " +
			JSON.stringify(rejection),
		"Você dispõe de até dois rounds adicionais de consulta e um round final de resposta estruturada. Releia as evidências decisivas ainda não entregues e tente refutar os candidatos antes de concluir.",
		"Referências devem usar exatamente fontes, revisões e intervalos entregues. Não invente leituras. Candidatos e findings devem corresponder por caminho e linha; preserve findings sustentados por evidências.",
		"Se a evidência necessária permanecer indisponível, use status incomplete, hipóteses unresolved e gaps explícitos. Não descarte problemas nem declare complete apenas para satisfazer a validação. Retorne o objeto completo no schema solicitado.",
	].join("\n\n");
}
