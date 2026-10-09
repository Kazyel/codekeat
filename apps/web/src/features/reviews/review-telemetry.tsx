import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { QueryFeedback } from "@/components/query-feedback";
import { Button } from "@/components/ui/button";
import type {
	AnalyticsInput,
	ReviewMetricEvent,
	ReviewTelemetrySummary,
} from "@/lib/api-contracts";
import { formatDuration, formatInteger, formatPeriod, formatUsdMicros } from "@/lib/format";
import { reviewTelemetryQuery, telemetrySummaryQuery } from "@/lib/queries";

const PHASE_LABEL: Readonly<Record<ReviewMetricEvent["phase"], string>> = {
	queue: "Fila",
	input: "Contexto",
	prepare: "Preparação",
	count: "Contagem",
	generation: "Geração",
	tool: "Ferramenta",
	judge: "Judge",
};
const OUTCOME_LABEL: Readonly<Record<ReviewMetricEvent["outcome"], string>> = {
	success: "Concluído",
	failed: "Falhou",
	ignored: "Ignorado",
	cancelled: "Cancelado",
};
const SIZE_LABEL: Readonly<Record<ReviewTelemetrySummary["sizeBand"], string>> = {
	small: "Até 64 KiB",
	medium: "64–512 KiB",
	large: "Acima de 512 KiB",
	unknown: "Não medido",
};
const CELL_CLASS = "whitespace-nowrap px-3 py-2 text-left tabular-nums";

export function ReviewTelemetry({
	reviewRunId,
	active,
}: {
	readonly reviewRunId: string;
	readonly active: boolean;
}): React.JSX.Element {
	const query = useInfiniteQuery(reviewTelemetryQuery(reviewRunId, active));
	return (
		<section aria-labelledby="review-telemetry" className="space-y-3">
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-display text-2xl font-semibold" id="review-telemetry">
					Etapas da execução
				</h2>
				<QueryFeedback
					isFetching={query.isFetching}
					isRefetchError={query.isRefetchError}
					onRefresh={() => void query.refetch()}
				/>
			</div>
			<p className="text-sm text-muted-foreground">
				Duração e consumo conhecidos de cada etapa. Cache é parte dos tokens de entrada. RSS
				mede a memória do processo compartilhado.
			</p>
			{query.data ? (
				<EventTable events={query.data.pages.flatMap((page) => page.events)} />
			) : (
				<TelemetryStatus failed={query.isError} />
			)}
			{query.hasNextPage ? (
				<Button
					variant="outline"
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}
				>
					{query.isFetchingNextPage ? "Carregando…" : "Carregar mais etapas"}
				</Button>
			) : null}
		</section>
	);
}

export function ReviewTelemetryAnalytics({
	input,
}: {
	readonly input: AnalyticsInput;
}): React.JSX.Element {
	const query = useQuery({ ...telemetrySummaryQuery(input), placeholderData: keepPreviousData });
	return (
		<section
			aria-labelledby="telemetry-analytics"
			className="surface-panel mt-6 space-y-4 p-4 sm:p-5"
		>
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-display text-2xl font-semibold" id="telemetry-analytics">
					Tempo por etapa e tamanho
				</h2>
				<QueryFeedback
					isFetching={query.isFetching}
					isRefetchError={query.isRefetchError}
					onRefresh={() => void query.refetch()}
				/>
			</div>
			<p className="text-sm text-muted-foreground">
				Últimos {query.data?.days ?? 30} dias. P50 e P95 usam amostras observadas. Etapas e
				operações internas têm séries separadas. A faixa corresponde ao tamanho do diff; o
				contexto do repositório tem uma medida separada.
			</p>
			{query.isPlaceholderData ? (
				<output className="block text-sm text-muted-foreground">
					Atualizando o recorte. A tabela ainda mostra a consulta anterior.
				</output>
			) : null}
			{query.data ? (
				<SummaryTable summaries={query.data.summaries} />
			) : (
				<TelemetryStatus failed={query.isError} />
			)}
		</section>
	);
}

function EventTable({
	events,
}: {
	readonly events: readonly ReviewMetricEvent[];
}): React.JSX.Element {
	if (events.length === 0)
		return (
			<p className="text-sm text-muted-foreground">
				Esta execução ainda não possui métricas registradas.
			</p>
		);
	return (
		<div className="overflow-x-auto rounded-lg border">
			<table className="w-full text-sm">
				<caption className="sr-only">Métricas de cada etapa e operação da review</caption>
				<thead className="bg-muted">
					<tr>
						{[
							"Etapa",
							"Tipo",
							"Resultado",
							"Duração",
							"Tokens entrada / saída",
							"Cache",
							"Custo conhecido",
							"Preflight tokens",
							"Bytes diff / contexto",
							"Fontes",
							"Requisições / cache",
							"Retries",
							"RSS processo",
						].map((label) => (
							<th className={CELL_CLASS} scope="col" key={label}>
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{events.map((event) => (
						<tr
							className="border-t"
							key={event.id}
							title={`Tentativa: ${event.attemptId ?? "–"}; chamada: ${event.callId ?? "–"}; unidade: ${event.unitId ?? "–"}`}
						>
							<td className={CELL_CLASS}>
								{PHASE_LABEL[event.phase]}
								{event.capacityFailure ? " · capacidade excedida" : ""}
							</td>
							<td className={CELL_CLASS}>{scopeLabel(event.scope)}</td>
							<td className={CELL_CLASS}>{OUTCOME_LABEL[event.outcome]}</td>
							<td className={CELL_CLASS}>{formatDuration(event.durationMs)}</td>
							<td className={CELL_CLASS}>{usageTokens(event.usage)}</td>
							<td className={CELL_CLASS}>
								{nullableCount(event.usage?.cacheTokens ?? null)}
							</td>
							<td className={CELL_CLASS}>
								{event.usage
									? formatUsdMicros(event.usage.costUsdMicros)
									: "Não informado"}
							</td>
							<td className={CELL_CLASS}>
								{nullableCount(event.countedInputTokens)}
							</td>
							<td className={CELL_CLASS}>
								{nullableCount(event.diffBytes)} /{" "}
								{nullableCount(event.sourceBytes)}
							</td>
							<td className={CELL_CLASS}>{nullableCount(event.sourceCount)}</td>
							<td className={CELL_CLASS}>
								{formatInteger(event.requestCount)} /{" "}
								{formatInteger(event.cacheHitCount)}
							</td>
							<td className={CELL_CLASS}>{formatInteger(event.retryCount)}</td>
							<td className={CELL_CLASS}>
								{formatInteger(Math.round(event.peakRssBytes / 1_048_576))} MiB
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function SummaryTable({
	summaries,
}: {
	readonly summaries: readonly ReviewTelemetrySummary[];
}): React.JSX.Element {
	if (summaries.length === 0)
		return (
			<p className="text-sm text-muted-foreground">
				Nenhuma métrica observada neste recorte.
			</p>
		);
	return (
		<div className="overflow-x-auto rounded-lg border">
			<table className="w-full text-sm">
				<caption className="sr-only">
					Percentis de duração por período, etapa, tipo e faixa de tamanho
				</caption>
				<thead className="bg-muted">
					<tr>
						{[
							"Período",
							"Etapa",
							"Tipo",
							"Tamanho diff",
							"Amostras / reviews",
							"P50",
							"P95",
							"Falhas / cancelados",
							"Requisições / cache",
							"Retries",
							"Limite excedido",
							"Custo conhecido",
							"RSS processo",
						].map((label) => (
							<th className={CELL_CLASS} scope="col" key={label}>
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{summaries.map((summary) => (
						<tr
							className="border-t"
							key={`${summary.period}:${summary.phase}:${summary.scope}:${summary.sizeBand}`}
						>
							<td className={CELL_CLASS}>{formatPeriod(summary.period)}</td>
							<td className={CELL_CLASS}>{PHASE_LABEL[summary.phase]}</td>
							<td className={CELL_CLASS}>{scopeLabel(summary.scope)}</td>
							<td className={CELL_CLASS}>{SIZE_LABEL[summary.sizeBand]}</td>
							<td className={CELL_CLASS}>
								{formatInteger(summary.sampleCount)} /{" "}
								{formatInteger(summary.runCount)}
							</td>
							<td className={CELL_CLASS}>{formatDuration(summary.p50DurationMs)}</td>
							<td className={CELL_CLASS}>{formatDuration(summary.p95DurationMs)}</td>
							<td className={CELL_CLASS}>
								{formatInteger(summary.failureCount)} /{" "}
								{formatInteger(summary.cancelledCount)}
							</td>
							<td className={CELL_CLASS}>
								{formatInteger(summary.requestCount)} /{" "}
								{formatInteger(summary.cacheHitCount)}
							</td>
							<td className={CELL_CLASS}>{formatInteger(summary.retryCount)}</td>
							<td className={CELL_CLASS}>
								{formatInteger(summary.capacityFailureCount)}
							</td>
							<td
								className={CELL_CLASS}
								title={`${summary.knownUsageCount} amostras com consumo informado`}
							>
								{summary.usage
									? formatUsdMicros(summary.usage.costUsdMicros)
									: "Não informado"}
							</td>
							<td className={CELL_CLASS}>
								{formatInteger(Math.round(summary.peakRssBytes / 1_048_576))} MiB
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function TelemetryStatus({ failed }: { readonly failed: boolean }): React.JSX.Element {
	return (
		<output className="block text-sm text-muted-foreground">
			{failed
				? "Não foi possível carregar as métricas. Use atualizar para tentar novamente."
				: "Carregando métricas…"}
		</output>
	);
}

function scopeLabel(scope: ReviewMetricEvent["scope"]): string {
	return scope === "phase" ? "Etapa" : "Operação";
}

function nullableCount(value: number | null): string {
	return value === null ? "Não informado" : formatInteger(value);
}

function usageTokens(usage: ReviewMetricEvent["usage"]): string {
	return usage === null
		? "Não informado"
		: `${formatInteger(usage.inputTokens)} / ${formatInteger(usage.outputTokens)}`;
}
