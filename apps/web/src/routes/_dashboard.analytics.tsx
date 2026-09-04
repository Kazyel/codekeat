import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BarChart3, CircleDollarSign, Gauge, Target } from "lucide-react";
import { useState } from "react";
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Legend,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { EmptyState } from "@/components/content-states";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { analyticsInputSchema } from "@/lib/api-contracts";
import { formatCompact, formatInteger, formatPeriod, formatUsdMicros } from "@/lib/format";
import { analyticsQuery } from "@/lib/queries";
const GROUP_BY_LABEL = {
	day: "Dia",
	week: "Semana",
	month: "Mês",
} satisfies Record<"day" | "month" | "week", string>;

export const Route = createFileRoute("/_dashboard/analytics")({
	validateSearch: (search) => analyticsInputSchema.catch({ groupBy: "day" }).parse(search),
	loaderDeps: ({ search }) => search,
	loader: ({ context, deps }) => context.queryClient.query(analyticsQuery(deps)),
	component: AnalyticsPage,
});

function AnalyticsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [repository, setRepository] = useState(search.repository ?? "");
	const { data } = useSuspenseQuery(analyticsQuery(search));
	const points = mergeAnalytics(data.usage, data.quality);
	const totalCost = data.usage.reduce((sum, item) => sum + item.costUsdMicros, 0);
	const completed = data.quality.reduce((sum, item) => sum + item.completedRunCount, 0);
	const accepted = data.quality.reduce((sum, item) => sum + item.acceptedFindingCount, 0);
	const evaluated = data.quality.reduce((sum, item) => sum + item.evaluatedFindingCount, 0);
	const approval = evaluated === 0 ? null : accepted / evaluated;

	const applyFilter = async (event: React.SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		const value = repository.trim();
		await navigate({ search: { groupBy: search.groupBy, repository: value || undefined } });
	};

	return (
		<div className="page-container">
			<PageHeader
				description="Uso, custo e qualidade agrupados com os mesmos filtros da API."
				eyebrow="Inteligência"
				title="Analytics"
			/>
			<form
				className="surface-panel mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
				onSubmit={applyFilter}
			>
				<label
					className="grid flex-1 gap-2 text-sm font-semibold text-foreground"
					htmlFor="repository"
				>
					Repositório
					<Input
						id="repository"
						autoComplete="off"
						name="repository"
						onChange={(event) => setRepository(event.target.value)}
						placeholder="Ex.: owner/repository…"
						value={repository}
					/>
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
								search: {
									groupBy: analyticsInputSchema.shape.groupBy.parse(value),
									repository: search.repository,
								},
							})
						}
						value={search.groupBy}
					>
						<SelectTrigger className="w-40" id="groupBy">
							<SelectValue>{GROUP_BY_LABEL[search.groupBy]}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="day">Dia</SelectItem>
							<SelectItem value="week">Semana</SelectItem>
							<SelectItem value="month">Mês</SelectItem>
						</SelectContent>
					</Select>
				</label>
				<Button type="submit">Aplicar filtros</Button>
			</form>
			<section aria-label="Resumo de analytics" className="grid gap-4 md:grid-cols-3">
				<Metric
					icon={CircleDollarSign}
					label="Custo total"
					value={formatUsdMicros(totalCost)}
				/>
				<Metric
					icon={BarChart3}
					label="Reviews concluídas"
					value={formatInteger(completed)}
				/>
				<Metric
					icon={Target}
					label="Taxa de aprovação"
					value={approval === null ? "Indisponível" : `${(approval * 100).toFixed(1)}%`}
				/>
			</section>
			{points.length === 0 ? (
				<div className="mt-5">
					<EmptyState
						description="A API ainda não retornou reviews concluídas para este recorte."
						title="Sem dados no período"
					/>
				</div>
			) : (
				<div className="mt-5 grid gap-5 xl:grid-cols-2">
					<ChartPanel title="Tokens e custo">
						<UsageChart data={points} />
					</ChartPanel>
					<ChartPanel title="Findings aceitos e aprovação">
						<QualityChart data={points} />
					</ChartPanel>
					<section className="data-table-shell xl:col-span-2">
						<div className="border-b border-border p-5">
							<p className="eyebrow">Leitura precisa</p>
							<h2 className="mt-1 text-lg font-semibold">Resumo por período</h2>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="text-left text-sm font-semibold text-muted-foreground">
										<th className="p-4">Período</th>
										<th className="p-4">Tokens</th>
										<th className="p-4">Custo</th>
										<th className="p-4">Concluídas</th>
										<th className="p-4">Aceitos</th>
										<th className="p-4">Aprovação</th>
									</tr>
								</thead>
								<tbody>
									{points.map((point) => (
										<tr className="border-t border-border" key={point.period}>
											<td className="p-4">{formatPeriod(point.period)}</td>
											<td className="p-4 tabular-nums">
												{formatInteger(point.tokens)}
											</td>
											<td className="p-4 tabular-nums">
												{formatUsdMicros(point.cost)}
											</td>
											<td className="p-4 tabular-nums">{point.completed}</td>
											<td className="p-4 tabular-nums">{point.accepted}</td>
											<td className="p-4 tabular-nums">
												{point.approval === null
													? "—"
													: `${(point.approval / 100).toFixed(1)}%`}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				</div>
			)}
		</div>
	);
}

function Metric({
	icon: Icon,
	label,
	value,
}: {
	readonly icon: typeof Gauge;
	readonly label: string;
	readonly value: string;
}) {
	return (
		<article className="surface-panel key-card p-5">
			<div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
				<Icon aria-hidden="true" className="size-4 text-primary" />
				{label}
			</div>
			<p className="metric-value">{value}</p>
		</article>
	);
}

function ChartPanel({
	title,
	children,
}: {
	readonly title: string;
	readonly children: React.ReactNode;
}) {
	return (
		<section className="surface-panel p-5">
			<h2 className="mb-6 text-base font-semibold">{title}</h2>
			<div className="h-72">{children}</div>
		</section>
	);
}

interface AnalyticsPoint {
	readonly period: string;
	readonly tokens: number;
	readonly cost: number;
	readonly accepted: number;
	readonly completed: number;
	readonly approval: number | null;
}

function mergeAnalytics(
	usage: readonly {
		readonly period: string;
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly cacheTokens: number;
		readonly costUsdMicros: number;
	}[],
	quality: readonly {
		readonly period: string;
		readonly completedRunCount: number;
		readonly acceptedFindingCount: number;
		readonly evaluatedFindingCount: number;
	}[],
): readonly AnalyticsPoint[] {
	const result = new Map<
		string,
		{
			period: string;
			tokens: number;
			cost: number;
			accepted: number;
			completed: number;
			evaluated: number;
		}
	>();
	for (const item of usage) {
		const point = result.get(item.period) ?? {
			period: item.period,
			tokens: 0,
			cost: 0,
			accepted: 0,
			completed: 0,
			evaluated: 0,
		};
		point.tokens += item.inputTokens + item.outputTokens + item.cacheTokens;
		point.cost += item.costUsdMicros;
		result.set(item.period, point);
	}
	for (const item of quality) {
		const point = result.get(item.period) ?? {
			period: item.period,
			tokens: 0,
			cost: 0,
			accepted: 0,
			completed: 0,
			evaluated: 0,
		};
		point.accepted += item.acceptedFindingCount;
		point.completed += item.completedRunCount;
		point.evaluated += item.evaluatedFindingCount;
		result.set(item.period, point);
	}
	return [...result.values()]
		.toSorted((left, right) => left.period.localeCompare(right.period))
		.map((point) => ({
			...point,
			approval:
				point.evaluated === 0
					? null
					: Math.round((point.accepted / point.evaluated) * 10_000),
		}));
}

function UsageChart({ data }: { readonly data: readonly AnalyticsPoint[] }) {
	return (
		<ResponsiveContainer height="100%" width="100%">
			<ComposedChart
				accessibilityLayer
				barCategoryGap="48%"
				data={data}
				margin={{ left: -8, right: 0, top: 4 }}
			>
				<CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
				<XAxis
					axisLine={false}
					dataKey="period"
					fontSize={11}
					tick={{ fill: "var(--muted-foreground)" }}
					tickFormatter={formatPeriod}
					tickLine={false}
					tickMargin={10}
				/>
				<YAxis
					axisLine={false}
					fontSize={11}
					tick={{ fill: "var(--muted-foreground)" }}
					tickFormatter={formatCompact}
					tickLine={false}
					width={52}
					yAxisId="tokens"
				/>
				<YAxis
					axisLine={false}
					domain={[0, "dataMax + 1"]}
					fontSize={11}
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
		</ResponsiveContainer>
	);
}

function QualityChart({ data }: { readonly data: readonly AnalyticsPoint[] }) {
	return (
		<ResponsiveContainer height="100%" width="100%">
			<ComposedChart
				accessibilityLayer
				barCategoryGap="48%"
				data={data}
				margin={{ left: -8, right: 0, top: 4 }}
			>
				<CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
				<XAxis
					axisLine={false}
					dataKey="period"
					fontSize={11}
					tick={{ fill: "var(--muted-foreground)" }}
					tickFormatter={formatPeriod}
					tickLine={false}
					tickMargin={10}
				/>
				<YAxis
					allowDecimals={false}
					axisLine={false}
					fontSize={11}
					tick={{ fill: "var(--muted-foreground)" }}
					tickLine={false}
					width={32}
					yAxisId="accepted"
				/>
				<YAxis
					axisLine={false}
					domain={[0, 10_000]}
					fontSize={11}
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
						name === "Aprovação"
							? `${Number(value) / 100}%`
							: formatInteger(Number(value)),
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
					name="Aprovação"
					stroke="var(--chart-1)"
					strokeWidth={3}
					type="monotone"
					yAxisId="approval"
				/>
			</ComposedChart>
		</ResponsiveContainer>
	);
}
