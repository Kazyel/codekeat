import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BrandLockup } from "../../../brand-lockup";

import { loadReviewRun } from "../../../lib/api-client";
import { readSession } from "../../../lib/session";
import { ReviewUsageDetails } from "../../../review-usage";

interface ReviewDetailPageProperties {
	readonly params: Promise<{ readonly reviewRunId: string }>;
}

export default async function ReviewDetailPage({
	params,
}: ReviewDetailPageProperties): Promise<ReactNode> {
	const session = await readSession();
	if (session === null) {
		redirect("/login");
	}

	const { reviewRunId } = await params;
	const reviewRun = await loadReviewRun(reviewRunId);
	if (reviewRun === null) {
		notFound();
	}

	return (
		<main className="shell">
			<Link className="back-link" href="/dashboard">
				← Todas as análises
			</Link>
			<header className="review-header">
				<div className="page-title">
					<BrandLockup />
					<div>
						<p className="eyebrow">{reviewRun.repositoryFullName}</p>
						<h1>PR #{reviewRun.pullRequestNumber}</h1>
						<div className="review-facts">
							<code>{reviewRun.headSha.slice(0, 7)}</code>
							<span>{reviewRun.status}</span>
							<span>{reviewRun.findingCount} findings</span>
							{reviewRun.githubCommentUrl === null ? null : (
								<a
									href={reviewRun.githubCommentUrl}
									rel="noreferrer"
									target="_blank"
								>
									Ver comentário no GitHub
								</a>
							)}
						</div>
					</div>
				</div>
			</header>

			<ReviewUsageDetails completedAt={reviewRun.completedAt} usage={reviewRun.usage} />

			{reviewRun.findings.length === 0 ? (
				<section className="empty-state">
					<h2>Nenhum problema concreto encontrado</h2>
					<p>
						O Codekeat concluiu esta análise sem Findings. A revisão humana continua
						importante.
					</p>
				</section>
			) : (
				<section className="finding-list" aria-label="Findings">
					{reviewRun.findings.map((finding) => (
						<article className={`finding finding-${finding.severity}`} key={finding.id}>
							<p className="severity">{finding.severity}</p>
							<h2>{finding.title}</h2>
							<code>
								{finding.path}:{finding.line}
							</code>
							<p>{finding.rationale}</p>
						</article>
					))}
				</section>
			)}
		</main>
	);
}
