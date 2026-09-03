import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { type DashboardReviewQuality, loadReviewQuality, loadReviewRuns } from "../lib/api-client";
import { readSession } from "../lib/session";
import { ReviewUsageSummary } from "../review-usage";

export default async function DashboardPage(): Promise<ReactNode> {
	const session = await readSession();
	if (session === null) {
		redirect("/login");
	}

	const [reviewRuns, quality] = await Promise.all([loadReviewRuns(), loadReviewQuality()]);
	return (
		<>
			<header className="content-header">
				<p className="eyebrow">Ledger de revisão</p>
				<h1>Pull requests analisados</h1>
			</header>

			<QualitySummary quality={quality} />

			<section className="run-list" aria-label="Review runs recentes">
				{reviewRuns.length === 0 ? (
					<p className="empty-state">Ainda não há análises para mostrar.</p>
				) : (
					reviewRuns.map((reviewRun) => (
						<Link
							className="run-card"
							href={`/dashboard/reviews/${reviewRun.id}`}
							key={reviewRun.id}
						>
							<span
								className={`status-dot status-${reviewRun.status}`}
								aria-hidden="true"
							/>
							<span className="run-main">
								<strong>{reviewRun.repositoryFullName}</strong>
								<span>PR #{reviewRun.pullRequestNumber}</span>
							</span>
							<span className="run-meta">
								<code>{reviewRun.headSha.slice(0, 7)}</code>
								<span>{reviewRun.findingCount} findings</span>
								<span>{reviewRun.status}</span>
								<ReviewUsageSummary
									completedAt={reviewRun.completedAt}
									usage={reviewRun.usage}
								/>
							</span>
						</Link>
					))
				)}
			</section>
		</>
	);
}

function QualitySummary({
	quality,
}: {
	readonly quality: readonly DashboardReviewQuality[];
}): ReactNode {
	const evaluated = quality.reduce((total, item) => total + item.evaluatedFindingCount, 0);
	const accepted = quality.reduce((total, item) => total + item.acceptedFindingCount, 0);
	const reviewCost = quality.reduce((total, item) => total + item.reviewCostUsdMicros, 0);
	const judgeCost = quality.reduce((total, item) => total + item.judgeCostUsdMicros, 0);
	const approvalRate = evaluated === 0 ? null : (accepted * 100) / evaluated;

	return (
		<section className="review-usage" aria-label="Qualidade e custo dos reviews">
			<h2>Qualidade medida pelo juiz</h2>
			<dl className="review-usage-grid">
				<div>
					<dt>Findings avaliados</dt>
					<dd>{evaluated.toLocaleString("pt-BR")}</dd>
				</div>
				<div>
					<dt>Taxa de aprovação</dt>
					<dd>{approvalRate === null ? "—" : `${approvalRate.toFixed(1)}%`}</dd>
				</div>
				<div>
					<dt>Custo do reviewer</dt>
					<dd>{formatUsdMicros(reviewCost)}</dd>
				</div>
				<div>
					<dt>Custo do juiz</dt>
					<dd>{formatUsdMicros(judgeCost)}</dd>
				</div>
			</dl>
		</section>
	);
}

function formatUsdMicros(value: number): string {
	return new Intl.NumberFormat("pt-BR", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 4,
	}).format(value / 1_000_000);
}
