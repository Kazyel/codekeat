import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, CircleDollarSign, GitPullRequestArrow, ShieldCheck } from "lucide-react";
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
import { NumberTicker } from "@/components/magic-ui/number-ticker";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { SignalHero } from "@/features/dashboard/signal-hero";
import {
	formatCompact,
	formatDateTime,
	formatInteger,
	formatPeriod,
	formatUsdMicros,
} from "@/lib/format";
import { overviewQuery } from "@/lib/queries";

export const Route = createFileRoute("/_dashboard/")({
	loader: ({ context }) => context.queryClient.query(overviewQuery),
	component: OverviewPage,
});

function OverviewPage() {
	const { data } = useSuspenseQuery(overviewQuery);
	const completedRuns = data.runs.filter((run) => run.status === "completed").length;
	const totalCost = data.usage.reduce((sum, item) => sum + item.costUsdMicros, 0);
	const acceptedFindings = data.quality.reduce((sum, item) => sum + item.acceptedFindingCount, 0);
	const chartData = aggregateSignalData(data.usage, data.quality);

	return (
		<div className="page-container space-y-6">
			<SignalHero>
				<h1 className="signal-title">
					O pulso das reviews.
					<br />
					Sem ruído.
				</h1>
				<p className="mt-6 max-w-xl text-[0.95rem] leading-6 text-muted-foreground">
					Operação recente, custo e qualidade reunidos para você decidir onde olhar
					primeiro.
				</p>
				<Button className="mt-6 w-fit" render={<Link to="/reviews" />}>
					Abrir histórico <ArrowUpRight aria-hidden="true" />
				</Button>
			</SignalHero>

			<section aria-label="Resumo" className="grid gap-4 md:grid-cols-3">
				<Metric
					icon={GitPullRequestArrow}
					label="Concluídas nos 50 runs recentes"
					value={<NumberTicker value={completedRuns} />}
				/>
				<Metric
					icon={ShieldCheck}
					label="Findings aceitos no período"
					value={<NumberTicker value={acceptedFindings} />}
				/>
				<Metric
					icon={CircleDollarSign}
					label="Custo acumulado disponível"
					value={<NumberTicker format={formatUsdMicros} value={totalCost} />}
				/>
			</section>

			<div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
				<section className="surface-panel p-5 sm:p-6">
					<div className="mb-6">
						<p className="eyebrow">Tendência</p>
						<h2 className="mt-1 text-lg font-semibold">Volume e qualidade</h2>
					</div>
					{chartData.length === 0 ? (
						<p className="grid h-64 place-items-center text-sm text-muted-foreground">
							Ainda não há períodos concluídos.
						</p>
					) : (
						<SignalChart data={chartData} />
					)}
				</section>
				<section className="surface-panel p-5 sm:p-6">
					<div className="mb-5 flex items-start justify-between">
						<div>
							<p className="eyebrow">Agora</p>
							<h2 className="mt-1 text-lg font-semibold">Atividade recente</h2>
						</div>
						<span className="text-xs text-muted-foreground">{data.runs.length}/50</span>
					</div>
					{data.runs.length === 0 ? (
						<EmptyState
							description="Abra ou atualize um PR elegível para iniciar o fluxo."
							title="Aguardando a primeira review"
						/>
					) : (
						<div className="space-y-1">
							{data.runs.slice(0, 6).map((run) => (
								<Link
									className="activity-row flex items-center justify-between gap-3 rounded-lg border-2 border-transparent px-2 py-3"
									key={run.id}
									search={{ reviewRunId: run.id }}
									to="/reviews"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-medium">
											{run.repositoryFullName}{" "}
											<span className="text-muted-foreground">
												#{run.pullRequestNumber}
											</span>
										</p>
										<p className="mt-1 text-[0.68rem] text-muted-foreground">
											{formatDateTime(run.createdAt)} · {run.findingCount}{" "}
											findings
										</p>
									</div>
									<StatusBadge status={run.status} />
								</Link>
							))}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}

function Metric({
	icon: Icon,
	label,
	value,
}: {
	readonly icon: typeof GitPullRequestArrow;
	readonly label: string;
	readonly value: React.ReactNode;
}) {
	return (
		<article className="surface-panel key-card p-5">
			<div className="flex items-center justify-between">
				<p className="metric-label">{label}</p>
				<span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
					<Icon aria-hidden="true" className="size-4" />
				</span>
			</div>
			<p className="metric-value">{value}</p>
		</article>
	);
}

interface SignalPoint {
	readonly period: string;
	readonly tokens: number;
	readonly accepted: number;
}

function aggregateSignalData(
	usage: readonly {
		readonly period: string;
		readonly inputTokens: number;
		readonly outputTokens: number;
	}[],
	quality: readonly { readonly period: string; readonly acceptedFindingCount: number }[],
): readonly SignalPoint[] {
	const points = new Map<string, { period: string; tokens: number; accepted: number }>();
	for (const item of usage) {
		const point = points.get(item.period) ?? { period: item.period, tokens: 0, accepted: 0 };
		point.tokens += item.inputTokens + item.outputTokens;
		points.set(item.period, point);
	}
	for (const item of quality) {
		const point = points.get(item.period) ?? { period: item.period, tokens: 0, accepted: 0 };
		point.accepted += item.acceptedFindingCount;
		points.set(item.period, point);
	}
	return [...points.values()]
		.toSorted((left, right) => left.period.localeCompare(right.period))
		.slice(-14);
}

function SignalChart({ data }: { readonly data: readonly SignalPoint[] }) {
	return (
		<figure
			className="h-72"
			aria-label="Gráfico de tokens processados e findings aceitos por período"
		>
			<ResponsiveContainer height="100%" width="100%">
				<ComposedChart
					accessibilityLayer
					barCategoryGap="48%"
					data={data}
					margin={{ left: -8, right: 0, top: 4 }}
				>
					<CartesianGrid
						stroke="var(--chart-grid)"
						strokeDasharray="4 4"
						vertical={false}
					/>
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
						width={54}
						yAxisId="tokens"
					/>
					<YAxis
						allowDecimals={false}
						axisLine={false}
						domain={[0, "dataMax + 1"]}
						fontSize={11}
						orientation="right"
						padding={{ bottom: 8, top: 8 }}
						tick={{ fill: "var(--muted-foreground)" }}
						tickLine={false}
						width={28}
						yAxisId="accepted"
					/>
					<Tooltip
						cursor={{ fill: "var(--chart-cursor)" }}
						formatter={(value, name) => [
							formatInteger(Number(value)),
							name === "Tokens" ? "Tokens" : "Findings aceitos",
						]}
						labelFormatter={(label) => formatPeriod(String(label))}
					/>
					<Legend align="right" height={32} verticalAlign="top" />
					<Bar
						dataKey="tokens"
						fill="var(--chart-1)"
						barSize={data.length === 1 ? 56 : 28}
						minPointSize={4}
						name="Tokens"
						radius={[7, 7, 2, 2]}
						yAxisId="tokens"
					/>
					<Line
						activeDot={{ r: 7, strokeWidth: 0 }}
						dataKey="accepted"
						dot={{
							fill: "var(--chart-2)",
							r: 5,
							stroke: "var(--card)",
							strokeWidth: 3,
						}}
						name="Findings aceitos"
						stroke="var(--chart-2)"
						strokeWidth={3}
						type="monotone"
						yAxisId="accepted"
					/>
				</ComposedChart>
			</ResponsiveContainer>
		</figure>
	);
}
