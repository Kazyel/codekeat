import GoogleGemini from "@thesvg/react/google-gemini";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Pencil, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/content-states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { createModelFn, selectModelFn, updateModelFn } from "@/lib/data.functions";
import { modelInputSchema, type Model, type ModelInput } from "@/lib/api-contracts";
import { formatTokenPricePerMillion } from "@/lib/format";
import { modelsQuery } from "@/lib/queries";

const EMPTY_MODEL: ModelInput = {
	displayName: "",
	apiName: "gemini-",
	inputNanoUsdPerToken: 0,
	cachedInputNanoUsdPerToken: 0,
	outputNanoUsdPerToken: 0,
	enabled: true,
};

type PriceLabel = "Input" | "Cache" | "Output";
const PRICE_STYLE: Readonly<
	Record<PriceLabel, { readonly marker: string; readonly surface: string }>
> = {
	Input: { marker: "bg-primary", surface: "bg-primary/10" },
	Cache: { marker: "bg-foreground", surface: "bg-secondary/50" },
	Output: { marker: "bg-accent", surface: "bg-accent/10" },
};

export const Route = createFileRoute("/_dashboard/models")({
	loader: ({ context }) => context.queryClient.query(modelsQuery),
	component: ModelsPage,
});

function ModelsPage() {
	const { user } = Route.useRouteContext();
	const { data: models } = useSuspenseQuery(modelsQuery);
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<Model | "new" | null>(null);
	const [draft, setDraft] = useState<ModelInput>(EMPTY_MODEL);
	const [validationError, setValidationError] = useState<string | null>(null);
	const saveMutation = useMutation({
		mutationFn: async () => {
			const parsed = modelInputSchema.safeParse(draft);
			if (!parsed.success) throw new Error("validation");
			return editing === "new"
				? createModelFn({ data: parsed.data })
				: updateModelFn({ data: { ...parsed.data, id: editing!.id } });
		},
		onSuccess: async (result) => {
			if (!result.ok) {
				toast.error(
					result.error === "conflict"
						? "Já existe um modelo com este nome de API."
						: "Não foi possível salvar o modelo.",
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey: modelsQuery.queryKey });
			setEditing(null);
			toast.success("Modelo salvo.");
		},
		onError: (error) => {
			if (error instanceof Error && error.message === "validation") {
				setValidationError(
					"Revise o nome e os preços. Todos os valores devem ser inteiros não negativos.",
				);
				return;
			}
			toast.error("O serviço de modelos está indisponível.");
		},
	});
	const selectMutation = useMutation({
		mutationFn: (id: string) => selectModelFn({ data: { id } }),
		onSuccess: async (result) => {
			if (!result.ok) {
				toast.error(
					result.error === "conflict"
						? "Ative o modelo antes de selecioná-lo."
						: "Não foi possível selecionar o modelo.",
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey: modelsQuery.queryKey });
			toast.success("Modelo padrão atualizado.");
		},
	});
	const isAdmin = user.role === "admin";

	const openEditor = (model: Model | "new") => {
		setValidationError(null);
		setDraft(
			model === "new"
				? EMPTY_MODEL
				: {
						displayName: model.displayName,
						apiName: model.apiName,
						inputNanoUsdPerToken: model.inputNanoUsdPerToken,
						cachedInputNanoUsdPerToken: model.cachedInputNanoUsdPerToken,
						outputNanoUsdPerToken: model.outputNanoUsdPerToken,
						enabled: model.enabled,
					},
		);
		setEditing(model);
	};

	return (
		<div className="page-container">
			<PageHeader
				action={
					isAdmin ? (
						<Button onClick={() => openEditor("new")}>
							<Plus aria-hidden="true" />
							Adicionar modelo
						</Button>
					) : null
				}
				description="Catálogo, preços por token e modelo ativo para novas reviews."
				eyebrow="Administração"
				title="Modelos Gemini"
			/>
			{!isAdmin ? (
				<output className="mb-5 block rounded-lg border-2 border-foreground bg-orange-100 px-4 py-3 text-sm font-medium text-orange-950 shadow-[4px_4px_0_var(--hard-shadow)] dark:bg-orange-950 dark:text-orange-100">
					Sua função permite consultar o catálogo. Alterações são restritas a
					administradores.
				</output>
			) : null}
			{models.length === 0 ? (
				<EmptyState
					description="Adicione um modelo Gemini para habilitar novas reviews."
					title="Nenhum modelo configurado"
				/>
			) : (
				<div className="grid gap-4 xl:grid-cols-2">
					{models.map((model) => (
						<article
							aria-label={`${model.displayName}${model.selected ? ", modelo padrão" : ""}`}
							className={`overflow-hidden rounded-xl border-2 ${model.selected ? "border-primary bg-primary text-primary-foreground shadow-[5px_5px_0_#8f0010]" : "border-[var(--foreground)] bg-card shadow-[5px_5px_0_var(--foreground)] dark:border-[rgb(255_255_255_/_22%)] dark:shadow-[5px_5px_0_rgb(255_255_255_/_22%)]"}`}
							key={model.id}
						>
							{model.selected ? (
								<div aria-hidden="true" className="h-1.5 bg-accent" />
							) : null}

							<header className="flex items-start justify-between gap-4 p-5 sm:p-6">
								<div className="flex min-w-0 items-start gap-4">
									<span
										className={`grid size-12 shrink-0 place-items-center rounded-xl border-2 bg-white shadow-[3px_3px_0_var(--hard-shadow)] ${model.selected ? "border-white" : "border-foreground"}`}
									>
										<GoogleGemini aria-hidden="true" className="size-7" />
									</span>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<h2 className="text-lg font-bold tracking-[-0.02em]">
												{model.displayName}
											</h2>
											{model.selected ? (
												<Badge
													className="border-white! bg-white! text-primary!"
													variant="outline"
												>
													<Sparkles aria-hidden="true" />
													Padrão
												</Badge>
											) : null}
										</div>
										<code
											className={`mt-2 inline-flex max-w-full truncate rounded-md px-2 py-1 font-mono text-[11px] font-semibold ${model.selected ? "bg-black/20 text-white" : "bg-secondary text-secondary-foreground"}`}
										>
											{model.apiName}
										</code>
									</div>
								</div>
								<span
									className={`flex shrink-0 items-center gap-2 rounded-full border-2 px-2.5 py-1 text-xs font-bold ${model.selected ? "border-white bg-white text-primary" : "border-foreground bg-card"}`}
								>
									<span
										aria-hidden="true"
										className={`size-2 rounded-full ${model.enabled ? "bg-emerald-500" : "bg-muted-foreground"}`}
									/>
									{model.enabled ? "Ativo" : "Inativo"}
								</span>
							</header>

							<div className="grid grid-cols-3">
								<Price
									label="Input"
									selected={model.selected}
									value={model.inputNanoUsdPerToken}
								/>
								<Price
									label="Output"
									selected={model.selected}
									value={model.outputNanoUsdPerToken}
								/>
								<Price
									label="Cache"
									selected={model.selected}
									value={model.cachedInputNanoUsdPerToken}
								/>
							</div>

							<footer
								className={`flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6 ${model.selected ? "bg-black/15" : "bg-secondary/35"}`}
							>
								<p
									className={`text-xs font-semibold ${model.selected ? "text-white/75" : "text-muted-foreground"}`}
								>
									Tarifas do catálogo
								</p>
								{isAdmin ? (
									<div className="flex gap-2">
										<Button
											onClick={() => openEditor(model)}
											size="sm"
											variant={model.selected ? "secondary" : "outline"}
										>
											<Pencil aria-hidden="true" />
											Editar
										</Button>
										{model.selected ? null : (
											<Button
												disabled={
													!model.enabled || selectMutation.isPending
												}
												onClick={() => selectMutation.mutate(model.id)}
												size="sm"
											>
												<Check aria-hidden="true" />
												Selecionar
											</Button>
										)}
									</div>
								) : null}
							</footer>
						</article>
					))}
				</div>
			)}
			<Dialog
				onOpenChange={(open) => {
					if (!open) setEditing(null);
				}}
				open={editing !== null}
			>
				<DialogContent className="sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>
							{editing === "new" ? "Adicionar modelo" : "Editar modelo"}
						</DialogTitle>
						<DialogDescription>
							Preços em nano USD por token, conforme o contrato da API.
						</DialogDescription>
					</DialogHeader>
					<form
						className="grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							setValidationError(null);
							saveMutation.mutate();
						}}
					>
						<EditorField label="Nome de exibição">
							<Input
								autoComplete="off"
								maxLength={100}
								name="displayName"
								onChange={(event) =>
									setDraft({ ...draft, displayName: event.target.value })
								}
								value={draft.displayName}
							/>
						</EditorField>
						<EditorField label="Nome da API">
							<Input
								className="technical"
								onChange={(event) =>
									setDraft({ ...draft, apiName: event.target.value })
								}
								autoComplete="off"
								name="apiName"
								placeholder="Ex.: gemini-2.5-pro…"
								value={draft.apiName}
							/>
						</EditorField>
						<div className="grid gap-3 sm:grid-cols-3">
							<NumberField
								label="Input"
								name="inputNanoUsdPerToken"
								onChange={(value) =>
									setDraft({ ...draft, inputNanoUsdPerToken: value })
								}
								value={draft.inputNanoUsdPerToken}
							/>
							<NumberField
								label="Cache"
								name="cachedInputNanoUsdPerToken"
								onChange={(value) =>
									setDraft({ ...draft, cachedInputNanoUsdPerToken: value })
								}
								value={draft.cachedInputNanoUsdPerToken}
							/>
							<NumberField
								label="Output"
								name="outputNanoUsdPerToken"
								onChange={(value) =>
									setDraft({ ...draft, outputNanoUsdPerToken: value })
								}
								value={draft.outputNanoUsdPerToken}
							/>
						</div>
						<label
							className="flex items-center gap-2 text-sm font-semibold"
							htmlFor="enabled"
						>
							<Checkbox
								id="enabled"
								name="enabled"
								checked={draft.enabled}
								onCheckedChange={(checked) =>
									setDraft({ ...draft, enabled: checked === true })
								}
							/>
							Disponível para seleção
						</label>
						{validationError ? (
							<p className="text-sm text-destructive" role="alert">
								{validationError}
							</p>
						) : null}
						<DialogFooter>
							<Button
								onClick={() => setEditing(null)}
								type="button"
								variant="outline"
							>
								Cancelar
							</Button>
							<Button disabled={saveMutation.isPending} type="submit">
								{saveMutation.isPending ? "Salvando…" : "Salvar modelo"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function Price({
	label,
	selected,
	value,
}: {
	readonly label: PriceLabel;
	readonly selected: boolean;
	readonly value: number;
}) {
	const style = PRICE_STYLE[label];
	const marker = selected ? "bg-white" : style.marker;
	const surface = selected ? "bg-black/10 text-white" : style.surface;
	const caption = selected ? "text-white/75" : "text-muted-foreground";

	return (
		<div className={`relative min-w-0 p-3 sm:p-5 ${surface}`}>
			<div className="flex items-center gap-2">
				<span aria-hidden="true" className={`size-2.5 rotate-45 ${marker}`} />
				<p className="text-xs font-bold sm:text-sm">{label}</p>
			</div>
			<p className="mt-3 truncate text-2xl font-bold tracking-[-0.035em] tabular-nums sm:text-3xl">
				{formatTokenPricePerMillion(value)}
			</p>
			<p className={`mt-1 truncate text-[11px] font-semibold ${caption}`}>por 1M tokens</p>
		</div>
	);
}

function EditorField({
	label,
	children,
}: {
	readonly label: string;
	readonly children: React.ReactNode;
}) {
	return (
		<label className="grid gap-1.5 text-sm font-medium">
			{label}
			{children}
		</label>
	);
}

function NumberField({
	label,
	name,
	value,
	onChange,
}: {
	readonly label: string;
	readonly name: string;
	readonly value: number;
	readonly onChange: (value: number) => void;
}) {
	return (
		<EditorField label={label}>
			<Input
				autoComplete="off"
				min={0}
				name={name}
				onChange={(event) => onChange(event.target.valueAsNumber || 0)}
				step={1}
				type="number"
				value={value}
			/>
		</EditorField>
	);
}
