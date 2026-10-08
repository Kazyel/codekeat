import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/content-states";
import { EmptyIllustration } from "@/components/empty-illustration";
import { CostIcon, FindingsIcon, ReviewIcon } from "@/components/product-icons";
import { QueryFeedback } from "@/components/query-feedback";
import { NumberTicker } from "@/components/magic-ui/number-ticker";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
	loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
	component: OverviewPage,
});

function OverviewPage(): React.JSX.Element {
	const { data, isFetching, isRefetchError, refetch } = useSuspenseQuery(overviewQuery);
	const completedRuns = data.runs.filter((run) => run.status === "completed").length;
	const totalCost = data.usage.reduce((sum, item) => sum + item.costUsdMicros, 0);
	const acceptedFindings = data.quality.reduce((sum, item) => sum + item.acceptedFindingCount, 0);
	const chartData = aggregateSignalData(data.usage, data.quality);
	const recentRuns = data.runs.slice(0, 4);

	return (
		<div className="page-container space-y-6 sm:space-y-8">
			<SignalHero>
				<h1 className="signal-title">
					O pulso das reviews.
					<br />
					Sem ruído.
				</h1>
				<p className="mt-4 max-w-xl text-base text-muted-foreground">
					Operação recente, custo e qualidade reunidos para você decidir onde olhar
					primeiro.
				</p>
				<div className="mt-6 flex flex-wrap items-center gap-2">
					<Button className="w-fit" render={<Link to="/reviews" />}>
						Abrir histórico <ArrowUpRight aria-hidden="true" />
					</Button>
					<QueryFeedback
						isFetching={isFetching}
						isRefetchError={isRefetchError}
						onRefresh={() => void refetch()}
					/>
				</div>
			</SignalHero>

			<section aria-label="Resumo" className="grid gap-4 md:grid-cols-3">
				<Metric
					icon={ReviewIcon}
					label="Reviews concluídas"
					description={`Nas ${data.runs.length} execuções mais recentes`}
					value={<NumberTicker value={completedRuns} />}
				/>
				<Metric
					icon={FindingsIcon}
					label="Findings aceitos"
					description="Em todo o histórico disponível"
					value={<NumberTicker value={acceptedFindings} />}
				/>
				<Metric
					icon={CostIcon}
					label="Custo acumulado"
					description="Em USD, no histórico disponível"
					value={<NumberTicker format={formatUsdMicros} value={totalCost} />}
				/>
			</section>

			<div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
				<section
					aria-labelledby="signal-heading"
					className="surface-panel min-w-0 p-5 sm:p-6"
				>
					<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="eyebrow">Tendência</p>
							<h2
								id="signal-heading"
								className="mt-1 font-display text-2xl font-semibold"
							>
								Volume e qualidade
							</h2>
							<p className="mt-2 text-sm text-muted-foreground">
								Últimos 14 dias com dados disponíveis.
							</p>
						</div>
						<Button
							render={<Link to="/analytics" search={{ groupBy: "day" }} />}
							size="sm"
							variant="outline"
						>
							Ver analytics <ArrowUpRight aria-hidden="true" />
						</Button>
					</div>
					{chartData.length === 0 ? (
						<div className="flex min-h-72 flex-col items-center justify-center gap-2 text-center">
							<EmptyIllustration />
							<p className="font-semibold">O primeiro sinal aparece aqui</p>
							<p className="text-sm leading-6 text-muted-foreground">
								Tokens e findings aceitos serão exibidos quando houver dados de uso
								ou qualidade.
							</p>
						</div>
					) : (
						<SignalChart data={chartData} />
					)}
				</section>
				<section
					aria-labelledby="activity-heading"
					className="surface-panel min-w-0 p-5 sm:p-6"
				>
					<div className="mb-4">
						<p className="eyebrow">Operação</p>
						<h2
							id="activity-heading"
							className="mt-1 font-display text-2xl font-semibold"
						>
							Atividade recente
						</h2>
						<p className="mt-2 text-sm text-muted-foreground">
							Exibindo {recentRuns.length} de {data.runs.length} execuções recentes.
						</p>
					</div>
					{data.runs.length === 0 ? (
						<EmptyState
							description="Abra ou atualize um PR elegível para iniciar o fluxo."
							title="Aguardando a primeira review"
							action={
								<Button
									className="mt-5"
									render={<Link to="/connections" />}
									variant="outline"
								>
									Ver conexões <ArrowUpRight aria-hidden="true" />
								</Button>
							}
						/>
					) : (
						<ul className="space-y-1">
							{recentRuns.map((run) => (
								<li key={run.id}>
									<Link
										className="activity-row block rounded-lg border-2 border-transparent px-2 py-3"
										search={{ reviewRunId: run.id }}
										to="/reviews"
									>
										<div className="flex items-center justify-between gap-3">
											<span className="flex items-center gap-2 text-sm font-semibold">
												<ReviewIcon
													aria-hidden="true"
													className="size-5 shrink-0 text-muted-foreground"
												/>
												PR #{run.pullRequestNumber}
											</span>
											<StatusBadge status={run.status} />
										</div>
										<p className="mt-2 break-words text-sm font-semibold [overflow-wrap:anywhere]">
											{run.repositoryFullName}
										</p>
										<div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground">
											<time dateTime={run.createdAt}>
												{formatDateTime(run.createdAt)}
											</time>
											<span className="tabular-nums">
												Findings: {formatInteger(run.findingCount)}
											</span>
										</div>
									</Link>
								</li>
							))}
						</ul>
					)}
					{data.runs.length > 0 ? (
						<div className="mt-4 pt-4">
							<Button
								className="w-full"
								render={<Link to="/reviews" />}
								variant="outline"
							>
								Ver histórico completo <ArrowUpRight aria-hidden="true" />
							</Button>
						</div>
					) : null}
				</section>
			</div>
		</div>
	);
}

function Metric({
	icon: Icon,
	label,
	description,
	value,
}: {
	readonly icon: React.ComponentType<React.ComponentProps<"svg">>;
	readonly label: string;
	readonly description: string;
	readonly value: React.ReactNode;
}): React.JSX.Element {
	return (
		<article className="surface-panel key-card grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 p-5 md:block md:p-6">
			<div className="flex items-start justify-between gap-3">
				<p className="metric-label">{label}</p>
				<Icon aria-hidden="true" className="hidden size-8 shrink-0 md:block" />
			</div>
			<p className="metric-value col-start-2 row-span-2 row-start-1 mt-0 max-w-44 break-words text-right text-3xl md:mt-4 md:max-w-none md:text-left md:text-5xl">
				{value}
			</p>
			<p className="mt-1 text-xs font-medium leading-5 md:mt-3">{description}</p>
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

function SignalChart({ data }: { readonly data: readonly SignalPoint[] }): React.JSX.Element {
	return (
		<figure aria-label="Gráfico de tokens processados e findings aceitos por período">
			<div className="h-72">
				<ComposedChart
					accessibilityLayer
					responsive
					className="size-full min-w-0"
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
						width={54}
						yAxisId="tokens"
					/>
					<YAxis
						allowDecimals={false}
						axisLine={false}
						domain={[0, "dataMax + 1"]}
						fontSize={12}
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
			</div>
			<figcaption className="mt-5 pt-4">
				<details className="group">
					<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
						Ver valores por dia
						<ChevronDown
							aria-hidden="true"
							className="size-4 transition-transform group-open:rotate-180"
						/>
					</summary>
					<Table>
						<TableCaption>Valores exatos dos dias exibidos no gráfico.</TableCaption>
						<TableHeader>
							<TableRow>
								<TableHead scope="col">Dia</TableHead>
								<TableHead scope="col" className="text-right">
									Tokens
								</TableHead>
								<TableHead scope="col" className="text-right whitespace-normal">
									Findings aceitos
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.map((point) => (
								<TableRow key={point.period}>
									<TableHead scope="row" className="font-medium">
										{formatPeriod(point.period)}
									</TableHead>
									<TableCell className="text-right tabular-nums">
										{formatInteger(point.tokens)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatInteger(point.accepted)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</details>
			</figcaption>
		</figure>
	);
}
