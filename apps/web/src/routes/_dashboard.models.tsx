import GoogleGemini from "@thesvg/react/google-gemini";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, LoaderCircle, Pencil, Plus, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/content-states";
import { PageHeader } from "@/components/page-header";
import { QueryFeedback } from "@/components/query-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ModelEditor } from "@/features/models/model-editor";
import type { Model } from "@/lib/api-contracts";
import { selectModelFn } from "@/lib/data.functions";
import { formatTokenPricePerMillion } from "@/lib/format";
import { modelsQuery, overviewQuery } from "@/lib/queries";

type PriceLabel = "Input" | "Cache" | "Output";
const PRICE_MARKER: Readonly<Record<PriceLabel, string>> = {
	Input: "bg-primary",
	Cache: "bg-foreground",
	Output: "bg-accent",
};

export const Route = createFileRoute("/_dashboard/models")({
	loader: ({ context }) => context.queryClient.ensureQueryData(modelsQuery),
	pendingComponent: ModelsPending,
	component: ModelsPage,
});

function ModelsPage() {
	const { user } = Route.useRouteContext();
	const { data: models, isFetching, isRefetchError, refetch } = useSuspenseQuery(modelsQuery);
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<Model | "new" | null>(null);
	const [selectionFeedback, setSelectionFeedback] = useState<{
		readonly id: string;
		readonly message: string;
	} | null>(null);
	const selectionInFlight = useRef(false);
	const selectMutation = useMutation({
		mutationFn: (model: Model) => selectModelFn({ data: { id: model.id } }),
		onSuccess: async (result, model) => {
			if (!result.ok) {
				setSelectionFeedback({
					id: model.id,
					message:
						result.error === "conflict"
							? `Não foi possível selecionar ${model.displayName}. Ative o modelo e tente novamente.`
							: `O serviço não confirmou a seleção de ${model.displayName}. Verifique a conexão e tente novamente.`,
				});
				return;
			}
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: modelsQuery.queryKey }),
				queryClient.invalidateQueries({ queryKey: overviewQuery.queryKey }),
			]);
			toast.success(`${model.displayName} definido como padrão para novas reviews.`);
		},
		onError: (_error, model) => {
			setSelectionFeedback({
				id: model.id,
				message: `O serviço não confirmou a seleção de ${model.displayName}. Verifique a conexão e tente novamente.`,
			});
		},
		onSettled: () => {
			selectionInFlight.current = false;
		},
	});
	const isAdmin = user.role === "admin";

	return (
		<div className="page-container">
			<PageHeader
				action={
					<div className="flex flex-wrap items-center gap-2">
						<QueryFeedback
							isFetching={isFetching}
							isRefetchError={isRefetchError}
							onRefresh={() => void refetch()}
						/>
						{isAdmin ? (
							<Button
								disabled={selectMutation.isPending}
								onClick={() => setEditing("new")}
							>
								<Plus aria-hidden="true" />
								Adicionar modelo
							</Button>
						) : null}
					</div>
				}
				description="Catálogo, preços por token e modelo ativo para novas reviews."
				eyebrow={isAdmin ? "Administração" : "Catálogo"}
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
					description={
						isAdmin
							? "Adicione um modelo Gemini para habilitar novas reviews."
							: "Um administrador precisa adicionar um modelo Gemini para habilitar novas reviews."
					}
					title="Nenhum modelo configurado"
				/>
			) : (
				<div className="grid gap-4 xl:grid-cols-2">
					{models.map((model) => (
						<article
							aria-busy={
								selectMutation.isPending &&
								selectMutation.variables?.id === model.id
							}
							aria-label={`${model.displayName}${model.selected ? ", modelo padrão" : ""}`}
							className={`min-w-0 overflow-hidden rounded-xl ${model.selected ? "bg-primary text-primary-foreground shadow-[5px_5px_0_#8f0010]" : "border-2 border-[var(--hard-shadow)] bg-card text-card-foreground shadow-[5px_5px_0_var(--hard-shadow)]"}`}
							key={model.id}
						>
							{model.selected ? (
								<div aria-hidden="true" className="h-1.5 bg-accent" />
							) : null}

							<header className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
								<div className="flex min-w-0 items-start gap-4">
									<span
										className={`grid size-12 shrink-0 place-items-center rounded-xl border-2 bg-white shadow-[3px_3px_0_var(--hard-shadow)] ${model.selected ? "border-white" : "border-[var(--hard-shadow)]"}`}
									>
										<GoogleGemini aria-hidden="true" className="size-7" />
									</span>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<h2 className="break-words font-display text-2xl font-bold tracking-[-0.02em]">
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
											className={`mt-2 inline-block max-w-full break-all rounded-md px-2 py-1 font-mono text-xs font-medium ${model.selected ? "bg-black/20 text-white" : "bg-muted text-muted-foreground"}`}
										>
											{model.apiName}
										</code>
									</div>
								</div>
								<span
									className={`flex shrink-0 items-center gap-2 rounded-full border-2 px-2.5 py-1 text-xs font-bold ${model.selected ? "border-white bg-white text-primary" : "border-[var(--hard-shadow)] bg-muted"}`}
								>
									<span
										aria-hidden="true"
										className={`size-2 rounded-full ${model.enabled ? "bg-emerald-500" : "bg-muted-foreground"}`}
									/>
									{model.enabled ? "Ativo" : "Inativo"}
								</span>
							</header>

							<dl
								className={`grid grid-cols-3 ${model.selected ? "bg-black/10 text-white" : "bg-muted"}`}
							>
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
							</dl>

							<footer
								className={`flex min-h-16 flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6 ${model.selected ? "bg-black/15" : "bg-card"}`}
							>
								<p
									className={`text-xs font-semibold ${model.selected ? "text-white/75" : "text-muted-foreground"}`}
								>
									USD por 1 milhão de tokens
								</p>
								{isAdmin ? (
									<div className="flex gap-2">
										<Button
											aria-label={`Editar ${model.displayName}`}
											className={
												model.selected
													? "text-white hover:bg-white/15 hover:text-white"
													: undefined
											}
											disabled={selectMutation.isPending}
											onClick={() => setEditing(model)}
											size="sm"
											variant="ghost"
										>
											<Pencil aria-hidden="true" />
											Editar
										</Button>
										{model.selected ? null : (
											<Button
												aria-busy={
													selectMutation.isPending &&
													selectMutation.variables?.id === model.id
												}
												aria-label={`Selecionar ${model.displayName} como padrão`}
												className="min-w-40"
												disabled={
													!model.enabled || selectMutation.isPending
												}
												onClick={() => {
													if (selectionInFlight.current) return;
													selectionInFlight.current = true;
													setSelectionFeedback(null);
													selectMutation.mutate(model);
												}}
												size="sm"
												variant="outline"
											>
												{selectMutation.isPending &&
												selectMutation.variables?.id === model.id ? (
													<LoaderCircle
														aria-hidden="true"
														className="motion-safe:animate-spin"
													/>
												) : (
													<Check aria-hidden="true" />
												)}
												{selectMutation.isPending &&
												selectMutation.variables?.id === model.id
													? "Selecionando…"
													: "Selecionar"}
											</Button>
										)}
									</div>
								) : null}
							</footer>
							{!model.enabled && isAdmin ? (
								<p className="px-5 pb-4 text-xs leading-relaxed text-muted-foreground sm:px-6">
									Edite e ative este modelo para selecioná-lo.
								</p>
							) : null}
							{selectionFeedback?.id === model.id ? (
								<p
									className={`px-5 pb-4 text-sm leading-relaxed sm:px-6 ${model.selected ? "text-white" : "text-destructive"}`}
									role="alert"
								>
									{selectionFeedback.message}
								</p>
							) : null}
						</article>
					))}
				</div>
			)}
			{isAdmin && editing !== null ? (
				<ModelEditor
					key={editing === "new" ? "new" : editing.id}
					model={editing}
					onClose={() => setEditing(null)}
				/>
			) : null}
		</div>
	);
}

function ModelsPending(): React.JSX.Element {
	return (
		<div className="page-container">
			<PageHeader
				description="Catálogo, preços por token e modelo ativo para novas reviews."
				eyebrow="Catálogo"
				title="Modelos Gemini"
			/>
			<output
				aria-label="Carregando catálogo de modelos"
				className="grid gap-4 xl:grid-cols-2"
			>
				{[0, 1].map((index) => (
					<div className="surface-panel loading-panel grid gap-6 p-5 sm:p-6" key={index}>
						<div aria-hidden="true" className="flex h-12 items-center gap-4">
							<Skeleton className="loading-accent size-12 shrink-0" />
							<div className="min-w-0 flex-1 space-y-3">
								<Skeleton className="h-4 w-3/4" />
								<Skeleton className="h-3 w-1/2" />
							</div>
						</div>
						<div aria-hidden="true" className="grid grid-cols-3 gap-4">
							{[0, 1, 2].map((price) => (
								<div
									className="flex h-16 flex-col justify-center gap-3"
									key={price}
								>
									<Skeleton className="h-3 w-3/4" />
									<Skeleton className="h-5 w-1/2" />
								</div>
							))}
						</div>
						<Skeleton className="h-8 w-1/2 justify-self-end" />
					</div>
				))}
			</output>
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
}): React.JSX.Element {
	const marker = selected ? "bg-white" : PRICE_MARKER[label];

	return (
		<div className="min-w-0 p-3 sm:p-5">
			<dt className="flex items-center gap-2">
				<span aria-hidden="true" className={`size-2.5 rotate-45 ${marker}`} />
				<span className="text-xs font-bold sm:text-sm">{label}</span>
			</dt>
			<dd className="mt-3 break-words text-lg font-bold tracking-[-0.025em] tabular-nums sm:text-2xl">
				{formatTokenPricePerMillion(value)}
			</dd>
		</div>
	);
}
