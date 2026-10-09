import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Copy, ExternalLink, FileCode2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { ExecutionIcon, FindingsIcon, ReviewIcon } from "@/components/product-icons";
import { QueryFeedback } from "@/components/query-feedback";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReviewRunDetail } from "@/lib/api-contracts";
import {
	formatCompact,
	formatDateTime,
	formatDuration,
	formatInteger,
	formatUsdMicros,
} from "@/lib/format";
import { reviewDetailQuery } from "@/lib/queries";
import { ReviewTelemetry } from "./review-telemetry";

const ERROR_LABEL: Readonly<Record<string, string>> = {
	finding_location_invalid: "O modelo indicou uma linha fora do diff.",
	gemini_invalid_response: "O Gemini retornou uma resposta inválida.",
	gemini_judge_invalid_response: "O judge retornou uma resposta inválida.",
	gemini_judge_request_failed: "A avaliação dos findings falhou.",
	gemini_request_failed: "A análise do Gemini falhou.",
	github_diff_file_limit_exceeded: "O pull request excedeu o limite de arquivos.",
	github_diff_unavailable: "O diff do GitHub não estava disponível.",
};
const IGNORE_LABEL: Readonly<Record<string, string>> = {
	repository_policy_disabled: "A policy do repositório desativou a review.",
	superseded_head_sha: "Um commit mais recente substituiu esta execução.",
	superseded_base_sha: "A base do PR mudou durante o carregamento desta execução.",
};
const SEVERITY_CLASS: Readonly<Record<ReviewRunDetail["findings"][number]["severity"], string>> = {
	critical: "badge-edge-rose bg-rose-500! text-white!",
	high: "badge-edge-rose bg-rose-300! text-rose-950! dark:bg-rose-400!",
	medium: "badge-edge-amber bg-amber-300! text-amber-950! dark:bg-amber-400!",
	low: "badge-edge-sky bg-sky-300! text-sky-950! dark:bg-sky-400!",
};
const JUDGE_LABEL: Readonly<Record<ReviewRunDetail["findings"][number]["judgeVerdict"], string>> = {
	not_evaluated: "Não avaliado pelo judge",
	approved: "Aceito pelo judge",
	rejected: "Rejeitado pelo judge",
	severity_changed: "Severidade ajustada pelo judge",
};
const REPORT_LABEL: Readonly<Record<NonNullable<ReviewRunDetail["reviewReportStatus"]>, string>> = {
	pending: "O relatório aguarda publicação no GitHub.",
	publishing: "O relatório está sendo publicado no GitHub.",
	published: "O relatório foi publicado no GitHub.",
	failed: "A análise foi concluída, mas a publicação do relatório falhou.",
};

interface ReviewDetailDrawerProps {
	readonly reviewRunId: string | undefined;
	readonly onOpenChange: (open: boolean) => void;
}

export function ReviewDetailDrawer({
	reviewRunId,
	onOpenChange,
}: ReviewDetailDrawerProps): React.JSX.Element {
	const [displayedReviewRunId, setDisplayedReviewRunId] = useState(reviewRunId);

	if (reviewRunId !== undefined && reviewRunId !== displayedReviewRunId) {
		setDisplayedReviewRunId(reviewRunId);
	}

	return (
		<Sheet
			onOpenChange={onOpenChange}
			onOpenChangeComplete={(open) => {
				if (!open && reviewRunId === undefined) setDisplayedReviewRunId(undefined);
			}}
			open={reviewRunId !== undefined}
		>
			{/* Preserve the review content until the sheet's exit transition finishes. */}
			{displayedReviewRunId ? (
				<ReviewDetailContent reviewRunId={displayedReviewRunId} />
			) : null}
		</Sheet>
	);
}

function ReviewDetailContent({ reviewRunId }: { readonly reviewRunId: string }) {
	const query = useQuery(reviewDetailQuery(reviewRunId));
	const run = query.data;

	return (
		<SheetContent className="w-full max-w-none sm:max-w-2xl lg:max-w-3xl p-0" side="right">
			<SheetHeader>
				<div className="flex items-center gap-3">
					<ReviewIcon aria-hidden="true" className="size-8 shrink-0 text-primary" />
					<SheetTitle className="min-w-0 wrap-anywhere text-3xl sm:text-4xl">
						{run ? `Review #${run.pullRequestNumber}` : "Detalhes da review"}
					</SheetTitle>
				</div>
				<SheetDescription className="mt-2 wrap-anywhere text-base font-medium text-foreground">
					{run
						? run.repositoryFullName
						: "Resultado e evidências da análise do pull request."}
				</SheetDescription>
				{run ? (
					<div className="mt-2 flex flex-wrap items-center gap-3">
						<StatusBadge status={run.status} />
						<QueryFeedback
							isFetching={query.isFetching}
							isRefetchError={query.isRefetchError}
							onRefresh={() => void query.refetch()}
						/>
					</div>
				) : null}
				{query.isPending ? <Skeleton aria-hidden="true" className="mt-2 h-6 w-28" /> : null}
			</SheetHeader>

			<div className="sheet-body" key={reviewRunId}>
				{query.isPending ? <DetailSkeleton /> : null}
				{query.isError && !run ? (
					<section
						className="rounded-xl bg-primary p-5 text-primary-foreground shadow-[4px_4px_0_#8f0b18] sm:p-6"
						role="alert"
					>
						<TriangleAlert aria-hidden="true" className="mb-4 size-7" />
						<h2 className="font-display text-3xl leading-tight">
							Detalhe indisponível
						</h2>
						<p className="mt-2 max-w-prose text-sm leading-6">
							Não foi possível buscar os dados desta execução. Tente carregar a review
							novamente.
						</p>
						<Button
							className="mt-5"
							onClick={() => void query.refetch()}
							variant="outline"
						>
							Tentar novamente
						</Button>
					</section>
				) : null}
				{run ? <ReviewDetail key={run.id} run={run} /> : null}
			</div>
		</SheetContent>
	);
}

function ReviewDetail({ run }: { readonly run: ReviewRunDetail }) {
	const reportFindings: ReviewRunDetail["findings"] = [];
	const excludedFindings: ReviewRunDetail["findings"] = [];
	for (const finding of run.findings) {
		if (finding.includedInReport && finding.judgeVerdict !== "rejected") {
			reportFindings.push(finding);
		} else {
			excludedFindings.push(finding);
		}
	}
	const outcome = reviewOutcome(run, reportFindings.length);
	const repositoryUrl = githubRepositoryUrl(run.repositoryFullName);
	const reportUrl = safeGitHubUrl(run.githubCommentUrl);

	return (
		<div className="space-y-8">
			<section aria-labelledby="review-outcome">
				<div
					className={`rounded-xl p-5 sm:p-6 ${run.status === "failed" ? "bg-primary text-primary-foreground shadow-[4px_4px_0_#8f0b18]" : "bg-accent text-accent-foreground shadow-[4px_4px_0_#9a3412]"}`}
				>
					<div className="mb-3 flex items-center gap-2 text-sm font-semibold">
						{run.status === "queued" || run.status === "running" ? (
							<ExecutionIcon aria-hidden="true" className="size-7 shrink-0" />
						) : (
							<ReviewIcon aria-hidden="true" className="size-7 shrink-0" />
						)}
						Resultado da análise
					</div>
					<h2
						className="wrap-anywhere font-display text-3xl leading-tight sm:text-4xl"
						id="review-outcome"
					>
						{outcome.title}
					</h2>
					<p className="mt-3 max-w-prose text-sm leading-6">{outcome.description}</p>
					<p className="mt-4 text-xs font-medium">
						Review consultiva; não bloqueia merge.
					</p>
				</div>
				<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
					{reportUrl ? (
						<Button
							render={
								<a
									aria-label="Abrir relatório no GitHub"
									href={reportUrl}
									rel="noreferrer"
									target="_blank"
								/>
							}
						>
							Abrir relatório <ExternalLink aria-hidden="true" />
						</Button>
					) : null}
					{repositoryUrl ? (
						<Button
							render={
								<a
									aria-label="Ver pull request no GitHub"
									href={`${repositoryUrl}/pull/${run.pullRequestNumber}`}
									rel="noreferrer"
									target="_blank"
								/>
							}
							variant="outline"
						>
							Ver pull request <ExternalLink aria-hidden="true" />
						</Button>
					) : null}
				</div>
			</section>

			<ReviewTelemetry
				reviewRunId={run.id}
				active={run.status === "queued" || run.status === "running"}
			/>

			<section aria-labelledby="review-findings">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<h2
						className="flex items-center gap-3 font-display text-2xl font-semibold"
						id="review-findings"
					>
						<FindingsIcon aria-hidden="true" className="size-7 shrink-0 text-accent" />
						{run.status === "completed"
							? "Findings do relatório"
							: "Findings registrados"}
					</h2>
					<span className="inline-flex min-w-8 items-center justify-center rounded-md bg-muted px-2 py-1 text-sm font-semibold tabular-nums text-foreground">
						{formatInteger(reportFindings.length)}
					</span>
				</div>
				{reportFindings.length > 0 ? (
					<div className="space-y-4">
						{reportFindings.map((finding) => (
							<FindingEvidence
								finding={finding}
								headSha={run.headSha}
								key={finding.id}
								repositoryUrl={repositoryUrl}
							/>
						))}
					</div>
				) : (
					<div className="control-surface rounded-xl border-2 bg-card p-5 shadow-[3px_3px_0_var(--control-edge)] sm:p-6">
						<div className="border-l-4 border-accent pl-4">
							<h3 className="font-display text-2xl font-semibold leading-tight">
								{run.status === "completed"
									? "Nenhum finding selecionado"
									: "Nenhum finding registrado"}
							</h3>
							<p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
								{run.status === "completed"
									? "A análise terminou sem findings selecionados para este relatório."
									: "Esta execução ainda não tem uma revisão concluída."}
							</p>
						</div>
					</div>
				)}
				{excludedFindings.length > 0 ? (
					<details className="group mt-5">
						<summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg bg-muted/60 px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
							Fora do relatório ({formatInteger(excludedFindings.length)})
							<ChevronDown
								aria-hidden="true"
								className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
							/>
						</summary>
						<p className="mb-4 mt-4 text-sm leading-6 text-muted-foreground">
							Candidatos rejeitados pelo judge ou não selecionados para o relatório.
						</p>
						<div className="space-y-6">
							{excludedFindings.map((finding) => (
								<FindingEvidence
									excluded
									finding={finding}
									headSha={run.headSha}
									key={finding.id}
									repositoryUrl={repositoryUrl}
								/>
							))}
						</div>
					</details>
				) : null}
			</section>

			<ExecutionSummary run={run} />
			<details className="control-surface group rounded-xl border-2 bg-card px-4 shadow-[3px_3px_0_var(--control-edge)] sm:px-5">
				<summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-md py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
					Detalhes técnicos
					<ChevronDown
						aria-hidden="true"
						className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
					/>
				</summary>
				<dl className="grid gap-x-5 gap-y-4 pb-5 pt-2 text-sm sm:grid-cols-2">
					<Meta label="Execução" value={run.id} />
					<Meta label="Criada" value={formatDateTime(run.createdAt)} />
					<Meta
						label="Encerrada"
						value={run.completedAt ? formatDateTime(run.completedAt) : "Não registrada"}
					/>
					<Meta label="Evento" value={run.trigger.replaceAll("_", " ")} />
					<Meta label="Estratégia" value={run.reviewStrategyVersion ?? "Indisponível"} />
					<Meta
						label="Policy"
						value={run.policySource === "repository" ? "Repositório" : "Padrão"}
					/>
					<Meta
						label="Chunks"
						value={run.reviewChunkCount?.toString() ?? "Indisponível"}
					/>
					<Meta
						label="Chamadas do judge"
						value={run.judgeCallCount?.toString() ?? "Indisponível"}
					/>
					<Meta
						label="Linhas alteradas"
						value={
							run.changedLineCount === null
								? "Indisponível"
								: formatInteger(run.changedLineCount)
						}
					/>
					<Meta label="Publicação" value={run.reviewReportStatus ?? "Não registrada"} />
					<Meta label="Consumo da análise" value={usageSummary(run.usage)} />
					<Meta label="Consumo do judge" value={usageSummary(run.judgeUsage)} />
					{run.errorCode ? <Meta label="Código da falha" value={run.errorCode} /> : null}
					{run.ignoreReason ? (
						<Meta label="Motivo do descarte" value={run.ignoreReason} />
					) : null}
					{run.policyWarningCode ? (
						<Meta label="Aviso da policy" value={run.policyWarningCode} />
					) : null}
				</dl>
				<CommitReference headSha={run.headSha} />
			</details>
		</div>
	);
}

function reviewOutcome(
	run: ReviewRunDetail,
	reportFindingCount: number,
): { readonly title: string; readonly description: string } {
	switch (run.status) {
		case "queued":
			return {
				title: "Aguardando processamento",
				description: "A execução está na fila. Ainda não há um resultado concluído.",
			};
		case "running":
			return {
				title: "Análise em andamento",
				description:
					"O processamento ainda não terminou. Findings registrados não representam um resultado final.",
			};
		case "failed":
			return {
				title: "A revisão não foi concluída",
				description:
					ERROR_LABEL[run.errorCode ?? ""] ??
					"A execução falhou. Consulte os detalhes técnicos e o pull request de origem.",
			};
		case "ignored":
			return {
				title: "Execução ignorada",
				description:
					IGNORE_LABEL[run.ignoreReason ?? ""] ??
					"Esta execução foi ignorada e não produziu uma revisão concluída.",
			};
		case "completed": {
			const findingLabel =
				reportFindingCount === 1 ? "finding selecionado" : "findings selecionados";
			return {
				title:
					reportFindingCount === 0
						? "Revisão concluída sem findings no relatório"
						: `${formatInteger(reportFindingCount)} ${findingLabel} para o relatório`,
				description: run.reviewReportStatus
					? REPORT_LABEL[run.reviewReportStatus]
					: "A análise foi concluída. A publicação do relatório não está registrada.",
			};
		}
	}
}

function FindingEvidence({
	finding,
	repositoryUrl,
	headSha,
	excluded = false,
}: {
	readonly finding: ReviewRunDetail["findings"][number];
	readonly repositoryUrl: string | null;
	readonly headSha: string;
	readonly excluded?: boolean;
}) {
	const locationUrl = findingLocationUrl(repositoryUrl, headSha, finding);
	return (
		<article
			className={
				excluded
					? "min-w-0"
					: "control-surface min-w-0 rounded-xl border-2 bg-card p-4 shadow-[3px_3px_0_var(--control-edge)] sm:p-5"
			}
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				{excluded ? (
					<span className="text-xs font-semibold text-muted-foreground">
						{finding.judgeSeverity ?? finding.severity}
					</span>
				) : (
					<SeverityBadge severity={finding.judgeSeverity ?? finding.severity} />
				)}
				<span className="min-w-0 wrap-anywhere text-xs text-muted-foreground">
					{JUDGE_LABEL[finding.judgeVerdict]}
				</span>
				{excluded ? (
					<span className="text-xs text-muted-foreground">Fora do relatório</span>
				) : null}
			</div>
			<h3 className="mt-3 wrap-anywhere text-lg font-semibold leading-7">{finding.title}</h3>
			<p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm leading-6">
				{finding.rationale}
			</p>
			{locationUrl ? (
				<a
					className="mt-4 flex min-h-11 items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring dark:hover:text-accent"
					href={locationUrl}
					rel="noreferrer"
					target="_blank"
				>
					<FileCode2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					<span className="min-w-0">
						<span className="technical wrap-anywhere">{finding.path}</span>
						<span className="mt-1 block text-xs text-muted-foreground">
							Linha {finding.line} no commit {headSha.slice(0, 8)}
						</span>
					</span>
					<ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
				</a>
			) : (
				<p className="mt-4 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
					<span className="technical wrap-anywhere">{finding.path}</span>
					<span className="mt-1 block text-xs">
						Linha {finding.line} · Link do commit indisponível
					</span>
				</p>
			)}
			{finding.judgeSeverity && finding.judgeSeverity !== finding.severity ? (
				<p className="mt-2 text-xs text-muted-foreground">
					Severidade original: {finding.severity}. Judge: {finding.judgeSeverity}.
				</p>
			) : null}
			{finding.judgeRationale ? (
				<div className="mt-4">
					<p className="text-xs font-semibold text-muted-foreground">Contexto do judge</p>
					<p className="mt-1 whitespace-pre-wrap wrap-anywhere text-sm leading-6 text-muted-foreground">
						{finding.judgeRationale}
					</p>
				</div>
			) : null}
		</article>
	);
}

function ExecutionSummary({ run }: { readonly run: ReviewRunDetail }) {
	const hasUsage = run.usage !== null || run.judgeUsage !== null;
	const cost = (run.usage?.costUsdMicros ?? 0) + (run.judgeUsage?.costUsdMicros ?? 0);
	return (
		<section aria-label="Resumo da execução">
			<h2 className="mb-4 flex items-center gap-3 font-display text-2xl font-semibold">
				<ExecutionIcon aria-hidden="true" className="size-7 shrink-0 text-accent" />
				Execução em resumo
			</h2>
			<dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm sm:grid-cols-3">
				<Meta
					label="Custo registrado"
					value={hasUsage ? formatUsdMicros(cost) : "Indisponível"}
				/>
				<Meta label="Processamento" value={formatDuration(run.processingDurationMs)} />
				<Meta label="Modelo" value={run.modelName ?? "Indisponível"} />
			</dl>
			{hasUsage && (run.usage === null || run.judgeUsage === null) ? (
				<p className="mt-2 text-xs text-muted-foreground">
					Consumo parcial:{" "}
					{run.usage === null ? "análise indisponível" : "judge indisponível"}.
				</p>
			) : null}
		</section>
	);
}

function usageSummary(usage: ReviewRunDetail["usage"]): string {
	if (usage === null) return "Indisponível";
	return `${formatUsdMicros(usage.costUsdMicros)} · ${formatCompact(usage.inputTokens + usage.outputTokens)} tokens`;
}

function Meta({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<div className="min-w-0">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="mt-1 wrap-anywhere font-medium tabular-nums">{value}</dd>
		</div>
	);
}

function CommitReference({ headSha }: { readonly headSha: string }) {
	const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
	async function copyCommit(): Promise<void> {
		setCopyState("copying");
		try {
			await navigator.clipboard.writeText(headSha);
			setCopyState("copied");
		} catch {
			setCopyState("failed");
		}
	}
	return (
		<div className="pb-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground">Commit analisado</p>
				<Button
					disabled={copyState === "copying"}
					onClick={() => void copyCommit()}
					size="sm"
					variant="ghost"
				>
					<Copy aria-hidden="true" />
					{copyState === "copying" ? "Copiando…" : "Copiar SHA"}
				</Button>
			</div>
			<code className="technical mt-1 block select-all break-all">{headSha}</code>
			<output className="mt-2 block text-xs text-muted-foreground">
				{copyState === "copied" ? "SHA copiado." : null}
				{copyState === "failed"
					? "Não foi possível copiar. Selecione o SHA acima para copiar manualmente."
					: null}
			</output>
		</div>
	);
}

function githubRepositoryUrl(repository: string): string | null {
	const segments = repository.split("/");
	if (segments.length !== 2 || segments.some(isInvalidPathSegment)) return null;
	return `https://github.com/${segments.map(encodeURIComponent).join("/")}`;
}

function isInvalidPathSegment(segment: string): boolean {
	return segment === "" || segment === "." || segment === "..";
}

function findingLocationUrl(
	repositoryUrl: string | null,
	headSha: string,
	finding: ReviewRunDetail["findings"][number],
): string | null {
	const segments = finding.path.split("/");
	if (!repositoryUrl || isInvalidPathSegment(headSha) || segments.some(isInvalidPathSegment))
		return null;
	return `${repositoryUrl}/blob/${encodeURIComponent(headSha)}/${segments.map(encodeURIComponent).join("/")}#L${finding.line}`;
}

function safeGitHubUrl(value: string | null): string | null {
	if (value === null) return null;
	try {
		const url = new URL(value);
		if (url.origin !== "https://github.com" || url.username || url.password) return null;
		return url.href;
	} catch {
		return null;
	}
}

function SeverityBadge({
	severity,
}: {
	readonly severity: ReviewRunDetail["findings"][number]["severity"];
}) {
	return (
		<Badge className={SEVERITY_CLASS[severity]} variant="outline">
			{severity}
		</Badge>
	);
}

function DetailSkeleton() {
	return (
		<output aria-label="Carregando detalhe" className="block space-y-8">
			<div className="rounded-xl bg-accent p-5 text-accent-foreground shadow-[4px_4px_0_#9a3412] sm:p-6">
				<div className="mb-4 flex items-center gap-2 text-sm font-semibold">
					<ExecutionIcon aria-hidden="true" className="size-5" />
					Carregando análise…
				</div>
				<div aria-hidden="true" className="space-y-3">
					<Skeleton className="h-8 w-4/5 bg-black/15" />
					<Skeleton className="h-4 w-full bg-black/15" />
					<Skeleton className="h-4 w-2/3 bg-black/15" />
				</div>
			</div>
			<div aria-hidden="true" className="space-y-4">
				<Skeleton className="h-7 w-48" />
				{[0, 1].map((index) => (
					<div
						className="control-surface space-y-3 rounded-xl border-2 bg-card p-5 shadow-[3px_3px_0_var(--control-edge)]"
						key={index}
					>
						<Skeleton className="h-6 w-20" />
						<Skeleton className="h-5 w-4/5" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-5/6" />
						<Skeleton className="mt-4 h-14 w-full" />
					</div>
				))}
			</div>
			<div aria-hidden="true" className="grid grid-cols-2 gap-4 sm:grid-cols-3">
				<Skeleton className="h-12" />
				<Skeleton className="h-12" />
				<Skeleton className="h-12" />
			</div>
		</output>
	);
}
