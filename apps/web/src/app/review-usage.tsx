"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import type { DashboardReviewRunSummary } from "./lib/api-client";

const INTEGER_FORMATTER = new Intl.NumberFormat("pt-BR");
const USD_FORMATTER = new Intl.NumberFormat("pt-BR", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 6,
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
	dateStyle: "short",
	timeStyle: "medium",
});

type ReviewUsage = DashboardReviewRunSummary["usage"];

interface ReviewUsageProperties {
	readonly completedAt: string | null;
	readonly usage: ReviewUsage;
	readonly title?: string;
}

export function ReviewUsageSummary({ completedAt, usage }: ReviewUsageProperties): ReactNode {
	return (
		<>
			<span>
				{completedAt === null ? (
					"Não concluída"
				) : (
					<LocalDateTime prefix="Concluída em " value={completedAt} />
				)}
			</span>
			<span>
				{usage === null ? "— tokens" : `${formatTokens(totalTokens(usage))} tokens`}
			</span>
			<span>{usage === null ? "—" : formatCost(usage.costUsdMicros)}</span>
		</>
	);
}

export function ReviewUsageDetails({
	completedAt,
	usage,
	title = "Uso da review",
}: ReviewUsageProperties): ReactNode {
	return (
		<section className="review-usage">
			<h2>{title}</h2>
			<dl className="review-usage-grid">
				<UsageMetric label="Realizada">
					{completedAt === null ? "Não concluída" : <LocalDateTime value={completedAt} />}
				</UsageMetric>
				<UsageMetric label="Total">
					{usage === null ? "—" : `${formatTokens(totalTokens(usage))} tokens`}
				</UsageMetric>
				<UsageMetric label="Entrada">
					{usage === null ? "—" : formatTokens(usage.inputTokens)}
				</UsageMetric>
				<UsageMetric label="Cache">
					{usage === null ? "—" : formatTokens(usage.cacheTokens)}
				</UsageMetric>
				<UsageMetric label="Saída">
					{usage === null ? "—" : formatTokens(usage.outputTokens)}
				</UsageMetric>
				<UsageMetric label="Custo">
					{usage === null ? "—" : formatCost(usage.costUsdMicros)}
				</UsageMetric>
			</dl>
		</section>
	);
}

function LocalDateTime({
	prefix = "",
	value,
}: {
	readonly prefix?: string;
	readonly value: string;
}) {
	const hydrated = useSyncExternalStore(
		subscribeToHydration,
		readBrowserSnapshot,
		readServerSnapshot,
	);
	const formatted = hydrated ? DATE_TIME_FORMATTER.format(new Date(value)) : "…";

	return <time dateTime={value}>{hydrated ? `${prefix}${formatted}` : formatted}</time>;
}

function UsageMetric({
	children,
	label,
}: {
	readonly children: ReactNode;
	readonly label: string;
}) {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{children}</dd>
		</div>
	);
}

function totalTokens(usage: Exclude<ReviewUsage, null>): number {
	return usage.inputTokens + usage.outputTokens;
}

function formatTokens(tokens: number): string {
	return INTEGER_FORMATTER.format(tokens);
}

function formatCost(costUsdMicros: number): string {
	return USD_FORMATTER.format(costUsdMicros / 1_000_000);
}

function subscribeToHydration(): () => void {
	return () => undefined;
}

function readBrowserSnapshot(): boolean {
	return true;
}

function readServerSnapshot(): boolean {
	return false;
}
