import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BrandLockup } from "../brand-lockup";

import { loadReviewRuns } from "../lib/api-client";
import { readSession } from "../lib/session";

export default async function DashboardPage(): Promise<ReactNode> {
  const session = await readSession();
  if (session === null) {
    redirect("/login");
  }

  const reviewRuns = await loadReviewRuns();
  return (
    <main className="shell">
      <header className="masthead">
        <div className="page-title">
          <BrandLockup />
          <div>
            <p className="eyebrow">Ledger de revisão</p>
            <h1>Pull requests analisados</h1>
          </div>
        </div>
        <form action="/logout" method="post">
          <button className="quiet-button" type="submit">
            Sair de {session.email}
          </button>
        </form>
      </header>

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
              <span className={`status-dot status-${reviewRun.status}`} aria-hidden="true" />
              <span className="run-main">
                <strong>{reviewRun.repositoryFullName}</strong>
                <span>PR #{reviewRun.pullRequestNumber}</span>
              </span>
              <span className="run-meta">
                <code>{reviewRun.headSha.slice(0, 7)}</code>
                <span>{reviewRun.findingCount} findings</span>
                <span>{reviewRun.status}</span>
              </span>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
