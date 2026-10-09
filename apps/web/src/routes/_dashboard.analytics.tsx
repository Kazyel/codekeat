import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Table2 } from "lucide-react";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis } from "recharts";

import { mergeAnalytics, type AnalyticsPoint } from "@/features/analytics/analytics-data";
import { EmptyState, ErrorState } from "@/components/content-states";
import { PageHeader } from "@/components/page-header";
import { CostIcon, FindingsIcon, ReviewIcon } from "@/components/product-icons";
import { QueryFeedback } from "@/components/query-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { analyticsInputSchema, type ReviewUsage, type ReviewQuality } from "@/lib/api-contracts";
import { formatCompact, formatInteger, formatPeriod, formatUsdMicros } from "@/lib/format";
import { analyticsQuery } from "@/lib/queries";
const GROUP_BY_LABEL = {
	day: "Dia",
	week: "Semana",
	month: "Mês",
} satisfies Record<"day" | "month" | "week", string>;

export const Route = createFileRoute("/_dashboard/analytics")({
	validateSearch: (search) =>
		analyticsInputSchema.parse({
			groupBy: analyticsInputSchema.shape.groupBy.catch("day").parse(search.groupBy),
			repository: analyticsInputSchema.shape.repository
				.catch(undefined)
				.parse(search.repository),
		}),
	component: AnalyticsPage,
});

function AnalyticsPage(): React.JSX.Element {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [filterError, setFilterError] = useState<string | null>(null);
	const query = useQuery({ ...analyticsQuery(search), placeholderData: keepPreviousData });

	const applyFilter = (event: React.SyntheticEvent<HTMLFormElement>): void => {
		event.preventDefault();
		const repository = new FormData(event.currentTarget).get("repository");
		const parsed = analyticsInputSchema.safeParse({
			groupBy: search.groupBy,
			repository:
				typeof repository === "string" ? repository.trim() || undefined : repository,
		});
		if (!parsed.success) {
			setFilterError("Use o formato organização/repositório ou deixe o campo vazio.");
			return;
		}
		setFilterError(null);
		void navigate({ resetScroll: false, search: parsed.data });
	};

	return (
		<div className="page-container">
			<PageHeader
				description="Acompanhe o volume de reviews, a aceitação dos findings e o custo de cada período."
				eyebrow="Inteligência"
				title="Analytics"
			/>
			<form
				className="mb-6 grid grid-cols-2 items-end gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_auto]"
				onSubmit={applyFilter}
			>
				<label
					className="col-span-2 grid min-w-0 gap-2 text-sm font-semibold text-foreground lg:col-span-1"
					htmlFor="repository"
				>
					Filtrar repositório
					<Input
						aria-invalid={filterError !== null}
						aria-describedby={filterError ? "repository-error" : undefined}
						id="repository"
						autoComplete="off"
						name="repository"
						onChange={() => setFilterError(null)}
						placeholder="Todos os repositórios"
						defaultValue={search.repository ?? ""}
						key={search.repository ?? ""}
					/>
					{filterError ? (
						<span
							className="text-sm font-normal text-destructive"
							id="repository-error"
							role="alert"
						>
							{filterError}
						</span>
					) : null}
				</label>
				<label
					className="grid gap-2 text-sm font-semibold text-foreground"
					htmlFor="groupBy"
				>
					Agrupar por
					<Select
						name="groupBy"
						onValueChange={(value) =>
							navigate({
								resetScroll: false,
								search: {
									groupBy: analyticsInputSchema.shape.groupBy.parse(value),
									repository: search.repository,
								},
							})
						}
						value={search.groupBy}
					>
						<SelectTrigger className="w-full" id="groupBy">
							<SelectValue>{GROUP_BY_LABEL[search.groupBy]}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="day">Dia</SelectItem>
							<SelectItem value="week">Semana</SelectItem>
							<SelectItem value="month">Mês</SelectItem>
						</SelectContent>
					</Select>
				</label>
				<div className="flex items-center gap-2">
					<Button className="h-11 min-w-28" disabled={query.isFetching} type="submit">
						{query.isFetching ? "Buscando…" : "Buscar"}
					</Button>
					<QueryFeedback
						isFetching={query.isFetching}
						isRefetchError={query.isRefetchError && query.data !== undefined}
						onRefresh={() => void query.refetch()}
					/>
				</div>
			</form>
			<AnalyticsContent
				query={query}
				scope={`${search.groupBy}:${search.repository ?? ""}`}
			/>
		</div>
	);
}

interface AnalyticsData {
	readonly usage: readonly ReviewUsage[];
	readonly quality: readonly ReviewQuality[];
}

function AnalyticsContent({
	query,
	scope,
}: {
	readonly query: UseQueryResult<AnalyticsData>;
	readonly scope: string;
}): React.JSX.Element {
	if (query.data)
		return (
			<>
				{query.isPlaceholderData ? (
					<output className="mb-4 block text-sm text-muted-foreground">
						Atualizando o recorte. Os valores abaixo são da consulta anterior.
					</output>
				) : null}
				<AnalyticsResults data={query.data} scope={scope} />
			</>
		);
	if (query.isError)
		return (
			<ErrorState
				description="Não foi possível consultar este recorte. Verifique os filtros e tente novamente."
				onRetry={() => void query.refetch()}
			/>
		);
	return (
		<output aria-label="Carregando analytics" className="block space-y-6">
			<div className="grid grid-cols-2 gap-4 md:grid-cols-3">
				{[0, 1, 2].map((index) => (
					<div
						aria-hidden="true"
						className="surface-panel loading-panel flex h-40 flex-col justify-between p-4 last:col-span-2 sm:p-5 md:last:col-span-1"
						key={index}
					>
						<div className="flex items-center justify-between gap-3">
							<Skeleton className="h-3 w-24 max-w-full" />
							<Skeleton className="loading-accent size-8 shrink-0" />
						</div>
						<Skeleton className="loading-accent h-8 w-16" />
						<Skeleton className="h-3 w-3/4" />
					</div>
				))}
			</div>
			<div className="grid gap-5 xl:grid-cols-2">
				{["Carregando uso e custo…", "Carregando qualidade…"].map((label) => (
					<div className="surface-panel loading-panel space-y-5 p-5" key={label}>
						<div className="loading-caption h-4">{label}</div>
						<div aria-hidden="true" className="loading-chart h-60">
							<Skeleton className="loading-accent h-1 w-20" />
						</div>
						<div aria-hidden="true" className="flex justify-between">
							<Skeleton className="h-3 w-12" />
							<Skeleton className="h-3 w-12" />
							<Skeleton className="h-3 w-12" />
						</div>
					</div>
				))}
			</div>
		</output>
	);
}

function AnalyticsResults({
	data,
	scope,
}: {
	readonly data: AnalyticsData;
	readonly scope: string;
}): React.JSX.Element {
	const points = mergeAnalytics(data.usage, data.quality);
	const totalCost = data.usage.reduce((sum, item) => sum + item.costUsdMicros, 0);
	const completed = data.quality.reduce((sum, item) => sum + item.completedRunCount, 0);
	const accepted = data.quality.reduce((sum, item) => sum + item.acceptedFindingCount, 0);
	const evaluated = data.quality.reduce((sum, item) => sum + item.evaluatedFindingCount, 0);
	const approval = evaluated === 0 ? null : accepted / evaluated;
	return (
		<>
			<section
				aria-label="Resumo de analytics"
				className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3"
			>
				<Metric
					className="bg-primary text-primary-foreground shadow-[4px_4px_0_#8f0b18]"
					description="Reviews finalizadas neste recorte."
					icon={ReviewIcon}
					label="Reviews concluídas"
					value={formatInteger(completed)}
				/>
				<Metric
					className="bg-accent text-accent-foreground shadow-[4px_4px_0_#9a3412]"
					description={
						approval === null ? "Nenhum finding avaliado." : "Dos findings avaliados."
					}
					icon={FindingsIcon}
					label="Aceitação dos findings"
					value={approval === null ? "—" : `${(approval * 100).toFixed(1)}%`}
				/>
				<Metric
					className="col-span-2 border-2 border-[var(--hard-shadow)] bg-[#171719] text-white shadow-[4px_4px_0_var(--hard-shadow)] md:col-span-1"
					description="Custo acumulado em dólares (USD)."
					icon={CostIcon}
					label="Custo total"
					value={formatUsdMicros(totalCost)}
				/>
			</section>
			{points.length === 0 ? (
				<div className="mt-5">
					<EmptyState
						description="Tente outro repositório ou remova o filtro para consultar todos os dados disponíveis."
						title="Nenhum dado para este recorte"
					/>
				</div>
			) : (
				<div className="mt-6 grid gap-5 xl:grid-cols-2">
					<ChartPanel
						description="Tokens à esquerda. Custo em USD à direita."
						icon={CostIcon}
						title="Consumo e custo"
					>
						<UsageChart data={points} />
					</ChartPanel>
					<ChartPanel
						description="Findings aceitos à esquerda. Taxa de aceitação à direita."
						icon={FindingsIcon}
						title="Qualidade das reviews"
					>
						<QualityChart data={points} />
					</ChartPanel>
					<details
						className="group overflow-hidden rounded-xl border-2 border-[var(--hard-shadow)] bg-card shadow-[4px_4px_0_var(--hard-shadow)] xl:col-span-2"
						key={scope}
					>
						<summary className="control-motion flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 hover:bg-accent/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5 [&::-webkit-details-marker]:hidden">
							<Table2 aria-hidden="true" className="size-5 shrink-0 text-accent" />
							<h2 className="flex-1 text-sm font-semibold">
								Dados por período
								<span className="mt-1 block text-xs font-normal text-muted-foreground">
									Consulte os valores exatos na tabela.
								</span>
							</h2>
							<ChevronDown
								aria-hidden="true"
								className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
							/>
						</summary>
						<section
							aria-label="Dados por período"
							className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
						>
							<table className="w-full text-sm">
								<caption className="sr-only">
									Uso, custo e qualidade das reviews por período
								</caption>
								<thead>
									<tr className="bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
										<th className="p-4" scope="col">
											Período
										</th>
										<th className="p-4 text-right" scope="col">
											Tokens
										</th>
										<th className="p-4 text-right" scope="col">
											Custo (USD)
										</th>
										<th className="p-4 text-right" scope="col">
											Concluídas
										</th>
										<th className="p-4 text-right" scope="col">
											Findings aceitos
										</th>
										<th className="p-4 text-right" scope="col">
											Aceitação
										</th>
									</tr>
								</thead>
								<tbody>
									{points.map((point) => (
										<tr className="hover:bg-muted/30" key={point.period}>
											<th
												className="whitespace-nowrap p-4 text-left font-medium"
												scope="row"
											>
												{formatPeriod(point.period)}
											</th>
											<td className="p-4 text-right tabular-nums">
												{formatInteger(point.tokens)}
											</td>
											<td className="p-4 text-right tabular-nums">
												{formatUsdMicros(point.cost)}
											</td>
											<td className="p-4 text-right tabular-nums">
												{point.completed}
											</td>
											<td className="p-4 text-right tabular-nums">
												{point.accepted}
											</td>
											<td className="p-4 text-right tabular-nums">
												{point.approval === null
													? "—"
													: `${(point.approval / 100).toFixed(1)}%`}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</section>
					</details>
				</div>
			)}
		</>
	);
}

function Metric({
	className,
	description,
	icon: Icon,
	label,
	value,
}: {
	readonly className: string;
	readonly description: string;
	readonly icon: React.ComponentType<React.ComponentProps<"svg">>;
	readonly label: string;
	readonly value: string;
}): React.JSX.Element {
	return (
		<article className={`min-w-0 rounded-xl p-4 sm:p-6 ${className}`}>
			<div className="flex items-start justify-between gap-3">
				<h2 className="min-h-10 text-sm font-semibold sm:min-h-0">{label}</h2>
				<Icon aria-hidden="true" className="hidden size-8 shrink-0 sm:block" />
			</div>
			<p className="mt-3 font-display text-3xl font-bold leading-none tracking-tight tabular-nums [overflow-wrap:anywhere] sm:text-4xl">
				{value}
			</p>
			<p className="mt-3 text-xs sm:text-sm">{description}</p>
		</article>
	);
}

function ChartPanel({
	description,
	icon: Icon,
	title,
	children,
}: {
	readonly description: string;
	readonly icon: React.ComponentType<React.ComponentProps<"svg">>;
	readonly title: string;
	readonly children: React.ReactNode;
}): React.JSX.Element {
	return (
		<section className="min-w-0 overflow-hidden rounded-xl border-2 border-[var(--hard-shadow)] bg-card shadow-[4px_4px_0_var(--hard-shadow)]">
			<header className="flex items-start gap-3 p-4 sm:p-5">
				<Icon aria-hidden="true" className="size-7 shrink-0 text-accent" />
				<div>
					<h2 className="font-display text-xl font-semibold">{title}</h2>
					<p className="mt-2 text-sm text-muted-foreground">{description}</p>
				</div>
			</header>
			<div className="h-64 px-2 pb-4 sm:h-72 sm:px-4">{children}</div>
		</section>
	);
}

function UsageChart({ data }: { readonly data: readonly AnalyticsPoint[] }) {
	return (
		<ComposedChart
			accessibilityLayer
			responsive
			className="size-full min-w-0"
			barCategoryGap="48%"
			data={data}
			margin={{ left: -8, right: 0, top: 4 }}
		>
			<CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
			<XAxis
				axisLine={false}
				dataKey="period"
				fontSize={12}
				tick={{ fill: "var(--muted-foreground)" }}
				tickFormatter={formatPeriod}
				tickLine={false}
				tickMargin={10}
			/>
			<YAxis
				axisLine={false}
				fontSize={12}
				tick={{ fill: "var(--muted-foreground)" }}
				tickFormatter={formatCompact}
				tickLine={false}
				width={52}
				yAxisId="tokens"
			/>
			<YAxis
				axisLine={false}
				domain={[0, "dataMax + 1"]}
				fontSize={12}
				orientation="right"
				padding={{ bottom: 8, top: 8 }}
				tick={{ fill: "var(--muted-foreground)" }}
				tickFormatter={formatUsdMicros}
				tickLine={false}
				width={68}
				yAxisId="cost"
			/>
			<Tooltip
				cursor={{ fill: "var(--chart-cursor)" }}
				formatter={(value, name) => [
					name === "Custo"
						? formatUsdMicros(Number(value))
						: formatInteger(Number(value)),
					name,
				]}
				labelFormatter={(label) => formatPeriod(String(label))}
			/>
			<Legend align="right" height={32} verticalAlign="top" />
			<Bar
				dataKey="tokens"
				fill="var(--chart-1)"
				barSize={data.length === 1 ? 48 : 24}
				minPointSize={4}
				name="Tokens"
				radius={[7, 7, 2, 2]}
				yAxisId="tokens"
			/>
			<Line
				activeDot={{ r: 7, strokeWidth: 0 }}
				dataKey="cost"
				dot={{
					fill: "var(--chart-2)",
					r: 5,
					stroke: "var(--card)",
					strokeWidth: 3,
				}}
				name="Custo"
				stroke="var(--chart-2)"
				strokeWidth={3}
				type="monotone"
				yAxisId="cost"
			/>
		</ComposedChart>
	);
}

function QualityChart({ data }: { readonly data: readonly AnalyticsPoint[] }) {
	return (
		<ComposedChart
			accessibilityLayer
			responsive
			className="size-full min-w-0"
			barCategoryGap="48%"
			data={data}
			margin={{ left: -8, right: 0, top: 4 }}
		>
			<CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
			<XAxis
				axisLine={false}
				dataKey="period"
				fontSize={12}
				tick={{ fill: "var(--muted-foreground)" }}
				tickFormatter={formatPeriod}
				tickLine={false}
				tickMargin={10}
			/>
			<YAxis
				allowDecimals={false}
				axisLine={false}
				fontSize={12}
				tick={{ fill: "var(--muted-foreground)" }}
				tickLine={false}
				width={32}
				yAxisId="accepted"
			/>
			<YAxis
				axisLine={false}
				domain={[0, 10_000]}
				fontSize={12}
				orientation="right"
				tick={{ fill: "var(--muted-foreground)" }}
				tickFormatter={(value: number) => `${value / 100}%`}
				tickLine={false}
				ticks={[0, 2500, 5000, 7500, 10_000]}
				width={42}
				yAxisId="approval"
			/>
			<Tooltip
				cursor={{ fill: "var(--chart-cursor)" }}
				formatter={(value, name) => [
					name === "Aceitação" ? `${Number(value) / 100}%` : formatInteger(Number(value)),
					name,
				]}
				labelFormatter={(label) => formatPeriod(String(label))}
			/>
			<Legend align="right" height={32} verticalAlign="top" />
			<Bar
				dataKey="accepted"
				fill="var(--chart-2)"
				barSize={data.length === 1 ? 48 : 24}
				minPointSize={4}
				name="Findings aceitos"
				radius={[7, 7, 2, 2]}
				yAxisId="accepted"
			/>
			<Line
				activeDot={{ r: 7, strokeWidth: 0 }}
				connectNulls
				dataKey="approval"
				dot={{
					fill: "var(--chart-1)",
					r: 5,
					stroke: "var(--card)",
					strokeWidth: 3,
				}}
				name="Aceitação"
				stroke="var(--chart-1)"
				strokeWidth={3}
				type="monotone"
				yAxisId="approval"
			/>
		</ComposedChart>
	);
}
