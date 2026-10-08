import { useForm, useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { modelInputSchema, type Model } from "@/lib/api-contracts";
import { createModelFn, updateModelFn } from "@/lib/data.functions";
import { modelsQuery, overviewQuery } from "@/lib/queries";

const priceDraftSchema = z.string().trim().regex(/^\d+$/).transform(Number);
const modelDraftSchema = modelInputSchema.extend({
	inputNanoUsdPerToken: priceDraftSchema.pipe(modelInputSchema.shape.inputNanoUsdPerToken),
	cachedInputNanoUsdPerToken: priceDraftSchema.pipe(
		modelInputSchema.shape.cachedInputNanoUsdPerToken,
	),
	outputNanoUsdPerToken: priceDraftSchema.pipe(modelInputSchema.shape.outputNanoUsdPerToken),
});

type ModelDraft = z.input<typeof modelDraftSchema>;
const PRICE_ERROR = "Use um inteiro não negativo válido, sem vírgula ou ponto.";
const EDITOR_FIELDS = [
	{
		name: "displayName",
		label: "Nome de exibição",
		error: "Informe um nome entre 1 e 100 caracteres.",
		price: false,
	},
	{
		name: "apiName",
		label: "Nome da API",
		error: "Use gemini- seguido de 1 a 120 letras minúsculas, números, pontos ou hífens.",
		price: false,
	},
	{ name: "inputNanoUsdPerToken", label: "Input", error: PRICE_ERROR, price: true },
	{ name: "cachedInputNanoUsdPerToken", label: "Cache", error: PRICE_ERROR, price: true },
	{ name: "outputNanoUsdPerToken", label: "Output", error: PRICE_ERROR, price: true },
] satisfies ReadonlyArray<{
	readonly name: Exclude<keyof ModelDraft, "enabled">;
	readonly label: string;
	readonly error: string;
	readonly price: boolean;
}>;

function initialDraft(model: Model | "new"): ModelDraft {
	if (model === "new") {
		return {
			displayName: "",
			apiName: "gemini-",
			inputNanoUsdPerToken: "",
			cachedInputNanoUsdPerToken: "",
			outputNanoUsdPerToken: "",
			enabled: true,
		};
	}
	return {
		displayName: model.displayName,
		apiName: model.apiName,
		inputNanoUsdPerToken: String(model.inputNanoUsdPerToken),
		cachedInputNanoUsdPerToken: String(model.cachedInputNanoUsdPerToken),
		outputNanoUsdPerToken: String(model.outputNanoUsdPerToken),
		enabled: model.enabled,
	};
}

export function ModelEditor({
	model,
	onClose,
}: {
	readonly model: Model | "new";
	readonly onClose: () => void;
}): React.JSX.Element {
	const queryClient = useQueryClient();
	const [defaultValues] = useState(() => initialDraft(model));
	const [formError, setFormError] = useState<string | null>(null);
	const submissionInFlight = useRef(false);
	const form = useForm({
		defaultValues,
		validators: {
			onBlur: modelDraftSchema,
			onChange: modelDraftSchema,
			onSubmit: modelDraftSchema,
		},
		onSubmitInvalid: ({ formApi }) => {
			const invalidField = EDITOR_FIELDS.find(
				(field) => formApi.getFieldMeta(field.name)?.isValid === false,
			);
			if (invalidField) {
				requestAnimationFrame(() => {
					document.getElementById(`model-${invalidField.name}`)?.focus();
				});
			}
		},
		onSubmit: async ({ value }) => {
			setFormError(null);
			const parsed = modelDraftSchema.safeParse(value);
			if (!parsed.success) {
				setFormError(
					"Revise os campos indicados antes de salvar. Seus dados foram mantidos.",
				);
				return;
			}
			try {
				const result =
					model === "new"
						? await createModelFn({ data: parsed.data })
						: await updateModelFn({ data: { ...parsed.data, id: model.id } });
				if (!result.ok) {
					let message =
						"O serviço não confirmou o salvamento. Seus dados foram mantidos; verifique a conexão e tente novamente.";
					if (result.error === "conflict") {
						message =
							model === "new" || parsed.data.enabled
								? "Já existe um modelo com este nome de API. Escolha um nome único e tente novamente. Seus dados foram mantidos."
								: "O nome da API pode estar em uso ou este modelo passou a ser o padrão. Use um nome único e mantenha o padrão disponível. Seus dados foram mantidos.";
					}
					setFormError(message);
					return;
				}
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: modelsQuery.queryKey }),
					queryClient.invalidateQueries({ queryKey: overviewQuery.queryKey }),
				]);
				toast.success(
					model === "new"
						? `${parsed.data.displayName} adicionado ao catálogo.`
						: `Alterações de ${parsed.data.displayName} salvas.`,
				);
				onClose();
			} catch {
				setFormError(
					"O serviço não confirmou o salvamento. Seus dados foram mantidos; verifique a conexão e tente novamente.",
				);
			}
		},
	});
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
	const isDefaultValue = useStore(form.store, (state) => state.isDefaultValue);
	const isSelected = model !== "new" && model.selected;
	let editorStatus = "";
	if (isSubmitting) editorStatus = "Salvando no servidor. Aguarde antes de sair.";
	else if (!isDefaultValue) editorStatus = "Alterações ainda não salvas.";
	const shouldKeepEditor = () =>
		submissionInFlight.current ||
		(!form.state.isDefaultValue &&
			!window.confirm("Descartar as alterações não salvas deste modelo?"));

	useBlocker({
		shouldBlockFn: shouldKeepEditor,
		enableBeforeUnload: () => submissionInFlight.current || !form.state.isDefaultValue,
	});

	return (
		<Dialog
			disablePointerDismissal={isSubmitting}
			onOpenChange={(open, details) => {
				if (open) return;
				if (shouldKeepEditor()) details.cancel();
				else onClose();
			}}
			open
		>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
				showCloseButton={!isSubmitting}
			>
				<DialogHeader>
					<DialogTitle>
						{model === "new" ? "Adicionar modelo" : "Editar modelo"}
					</DialogTitle>
					<DialogDescription>
						Preços em nano USD por token. 1.000 nano USD por token equivalem a US$ 1 por
						milhão de tokens.
					</DialogDescription>
				</DialogHeader>
				<form
					aria-busy={isSubmitting}
					className="grid gap-5"
					noValidate
					onSubmit={async (event) => {
						event.preventDefault();
						if (submissionInFlight.current) return;
						submissionInFlight.current = true;
						try {
							await form.handleSubmit();
						} finally {
							submissionInFlight.current = false;
						}
					}}
				>
					<fieldset className="grid min-w-0 gap-4 sm:grid-cols-3" disabled={isSubmitting}>
						<legend className="sr-only">Configuração do modelo</legend>
						{EDITOR_FIELDS.map((definition) => (
							<form.Field key={definition.name} name={definition.name}>
								{(field) => {
									const invalid =
										field.state.meta.isTouched && !field.state.meta.isValid;
									const id = `model-${field.name}`;
									return (
										<Field
											className={
												definition.price ? "min-w-0" : "sm:col-span-3"
											}
											data-invalid={invalid}
										>
											<FieldLabel htmlFor={id}>{definition.label}</FieldLabel>
											<Input
												aria-describedby={
													invalid ? `${id}-error` : undefined
												}
												aria-invalid={invalid}
												autoComplete="off"
												className={
													definition.price ||
													definition.name === "apiName"
														? "font-mono tabular-nums"
														: undefined
												}
												id={id}
												inputMode={definition.price ? "numeric" : "text"}
												name={field.name}
												onBlur={field.handleBlur}
												onChange={(event) => {
													setFormError(null);
													field.handleChange(event.target.value);
												}}
												placeholder={
													definition.price ? "Inteiro ≥ 0" : undefined
												}
												spellCheck={false}
												type="text"
												value={field.state.value}
											/>
											{invalid ? (
												<FieldError id={`${id}-error`}>
													{definition.error}
												</FieldError>
											) : null}
										</Field>
									);
								}}
							</form.Field>
						))}
						<form.Field name="enabled">
							{(field) => (
								<Field className="sm:col-span-3">
									<div className="flex items-center gap-2">
										<Checkbox
											aria-describedby={
												isSelected ? "model-enabled-hint" : undefined
											}
											checked={field.state.value}
											disabled={isSelected || isSubmitting}
											id="model-enabled"
											name={field.name}
											onBlur={field.handleBlur}
											onCheckedChange={(checked) => {
												setFormError(null);
												field.handleChange(checked === true);
											}}
										/>
										<FieldLabel htmlFor="model-enabled">
											Disponível para seleção
										</FieldLabel>
									</div>
									{isSelected ? (
										<p
											className="text-xs leading-relaxed text-muted-foreground"
											id="model-enabled-hint"
										>
											Para desativar este modelo, selecione outro como padrão
											primeiro.
										</p>
									) : null}
								</Field>
							)}
						</form.Field>
					</fieldset>
					{formError ? (
						<p className="text-sm leading-relaxed text-destructive" role="alert">
							{formError}
						</p>
					) : null}
					<output className="min-h-5 text-xs text-muted-foreground">
						{editorStatus}
					</output>
					<DialogFooter>
						<Button
							disabled={isSubmitting}
							onClick={() => {
								if (!shouldKeepEditor()) onClose();
							}}
							type="button"
							variant="outline"
						>
							Cancelar
						</Button>
						<Button
							aria-busy={isSubmitting}
							className="min-w-40"
							disabled={isSubmitting}
							type="submit"
						>
							{isSubmitting ? (
								<LoaderCircle
									aria-hidden="true"
									className="motion-safe:animate-spin"
								/>
							) : null}
							{isSubmitting ? "Salvando…" : "Salvar modelo"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
