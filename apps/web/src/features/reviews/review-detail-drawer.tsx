import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileCode2, GitCommitHorizontal, Timer } from "lucide-react";

import { EmptyState, ErrorState } from "@/components/content-states";
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
import { formatCompact, formatDateTime, formatDuration, formatUsdMicros } from "@/lib/format";
import { reviewDetailQuery } from "@/lib/queries";

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
};
const SEVERITY_CLASS: Readonly<Record<ReviewRunDetail["findings"][number]["severity"], string>> = {
	critical: "badge-edge-rose bg-rose-500! text-white!",
	high: "badge-edge-rose bg-rose-300! text-rose-950! dark:bg-rose-400!",
	medium: "badge-edge-amber bg-amber-300! text-amber-950! dark:bg-amber-400!",
	low: "badge-edge-sky bg-sky-300! text-sky-950! dark:bg-sky-400!",
};

interface ReviewDetailDrawerProps {
	readonly reviewRunId: string | undefined;
	readonly onOpenChange: (open: boolean) => void;
}

export function ReviewDetailDrawer({ reviewRunId, onOpenChange }: ReviewDetailDrawerProps) {
	return (
		<Sheet onOpenChange={onOpenChange} open={reviewRunId !== undefined}>
			{reviewRunId ? <ReviewDetailContent reviewRunId={reviewRunId} /> : null}
		</Sheet>
	);
}

function ReviewDetailContent({ reviewRunId }: { readonly reviewRunId: string }) {
	const query = useQuery(reviewDetailQuery(reviewRunId));
	const run = query.data;

	return (
		<SheetContent
			className="w-full! max-w-none! border-l-2! border-foreground p-0 sm:max-w-2xl! lg:max-w-3xl!"
			side="right"
		>
			<SheetHeader className="shrink-0 border-b-2 border-foreground px-5 py-5 pr-14 sm:px-6">
				<p className="eyebrow">Detalhe da execução</p>
				<div className="flex flex-wrap items-center gap-3">
					<SheetTitle className="font-['Pixelify_Sans'] text-2xl font-bold tracking-[-0.03em]">
						{run ? `Review #${run.pullRequestNumber}` : "Detalhes da review"}
					</SheetTitle>
					{run ? <StatusBadge status={run.status} /> : null}
				</div>
				<SheetDescription>
					{run ? run.repositoryFullName : "Carregando dados da execução…"}
				</SheetDescription>
			</SheetHeader>

			<div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
				{query.isPending ? <DetailSkeleton /> : null}
				{query.isError ? (
					<ErrorState
						description="Não foi possível buscar os dados desta execução."
						onRetry={() => void query.refetch()}
						title="Detalhe indisponível"
					/>
				) : null}
				{run ? <ReviewDetail run={run} /> : null}
			</div>
		</SheetContent>
	);
}

function ReviewDetail({ run }: { readonly run: ReviewRunDetail }) {
	const totalCost = (run.usage?.costUsdMicros ?? 0) + (run.judgeUsage?.costUsdMicros ?? 0);
	const totalTokens =
		(run.usage?.inputTokens ?? 0) +
		(run.usage?.outputTokens ?? 0) +
		(run.judgeUsage?.inputTokens ?? 0) +
		(run.judgeUsage?.outputTokens ?? 0);

	return (
		<div className="space-y-5">
			{run.errorCode ? (
				<RunNotice
					kind="error"
					text={
						ERROR_LABEL[run.errorCode] ?? "A review terminou com uma falha conhecida."
					}
				/>
			) : null}
			{run.ignoreReason ? (
				<RunNotice
					kind="ignored"
					text={IGNORE_LABEL[run.ignoreReason] ?? "A review foi ignorada."}
				/>
			) : null}

			<section aria-label="Métricas da execução" className="grid grid-cols-2 gap-3">
				<DetailMetric
					icon={GitCommitHorizontal}
					label="Commit"
					mono
					value={run.headSha.slice(0, 8)}
				/>
				<DetailMetric
					icon={Timer}
					label="Processamento"
					value={formatDuration(run.processingDurationMs)}
				/>
				<DetailMetric
					icon={FileCode2}
					label="Linhas alteradas"
					value={
						run.changedLineCount === null
							? "Indisponível"
							: formatCompact(run.changedLineCount)
					}
				/>
				<DetailMetric
					label="Custo total"
					value={run.usage ? formatUsdMicros(totalCost) : "Indisponível"}
				/>
			</section>

			<section className="surface-panel p-5">
				<h2 className="text-base font-semibold">Execução</h2>
				<div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 sm:gap-x-8">
					<Meta label="Criada" value={formatDateTime(run.createdAt)} />
					<Meta
						label="Concluída"
						value={run.completedAt ? formatDateTime(run.completedAt) : "—"}
					/>
					<Meta label="Trigger" value={run.trigger.replaceAll("_", " ")} />
					<Meta label="Modelo" value={run.modelName ?? "—"} />
					<Meta label="Estratégia" value={run.reviewStrategyVersion ?? "—"} />
					<Meta label="Policy" value={run.policySource} />
					<Meta label="Chunks" value={run.reviewChunkCount?.toString() ?? "—"} />
					<Meta label="Tokens" value={totalTokens ? formatCompact(totalTokens) : "—"} />
					<Meta label="Relatório" value={run.reviewReportStatus ?? "—"} />
				</div>
				{run.githubCommentUrl ? (
					<Button
						className="mt-5 w-full sm:w-auto"
						render={
							<a
								aria-label="Abrir comentário no GitHub"
								href={run.githubCommentUrl}
								rel="noreferrer"
								target="_blank"
							/>
						}
						variant="outline"
					>
						Abrir comentário <ExternalLink aria-hidden="true" />
					</Button>
				) : null}
			</section>

			<section>
				<div className="mb-4 flex items-end justify-between">
					<div>
						<p className="eyebrow">Resultado</p>
						<h2 className="mt-1 text-xl font-semibold">Findings</h2>
					</div>
					<span className="text-sm tabular-nums text-muted-foreground">
						{run.findings.length}
					</span>
				</div>
				{run.findings.length === 0 ? (
					<EmptyState
						description="A análise não encontrou problemas concretos para publicar."
						title="Nenhum finding"
					/>
				) : (
					<div className="space-y-3">
						{run.findings.map((finding) => (
							<article className="surface-panel p-5" key={finding.id}>
								<div className="flex flex-wrap items-center gap-2">
									<SeverityBadge
										severity={finding.judgeSeverity ?? finding.severity}
									/>
									<Badge variant="outline">
										{finding.judgeVerdict.replaceAll("_", " ")}
									</Badge>
									{finding.includedInReport ? null : (
										<Badge variant="secondary">Fora do relatório</Badge>
									)}
								</div>
								<h3 className="mt-4 text-base font-semibold">{finding.title}</h3>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">
									{finding.rationale}
								</p>
								<div className="mt-4 flex items-center gap-2 rounded-lg border-2 border-foreground bg-card px-3 py-2.5 text-sm font-medium shadow-[2px_2px_0_var(--hard-shadow)]">
									<FileCode2
										aria-hidden="true"
										className="size-3.5 text-primary"
									/>
									<span className="technical truncate">{finding.path}</span>
									<span className="ml-auto text-muted-foreground">
										linha {finding.line}
									</span>
								</div>
								{finding.judgeRationale ? (
									<p className="mt-3 border-l-2 border-accent pl-3 text-sm font-medium leading-6 text-muted-foreground">
										Judge: {finding.judgeRationale}
									</p>
								) : null}
							</article>
						))}
					</div>
				)}
			</section>
		</div>
	);
}

function DetailMetric({
	icon: Icon,
	label,
	value,
	mono = false,
}: {
	readonly icon?: typeof Timer;
	readonly label: string;
	readonly value: string;
	readonly mono?: boolean;
}) {
	return (
		<article className="surface-panel p-4">
			<div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
				{Icon ? <Icon aria-hidden="true" className="size-4 text-primary" /> : null}
				{label}
			</div>
			<p
				className={
					mono
						? "mt-3 font-mono text-lg font-bold"
						: "mt-3 text-lg font-bold tabular-nums"
				}
			>
				{value}
			</p>
		</article>
	);
}

function Meta({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<div className="flex items-start justify-between gap-4">
			<span className="text-muted-foreground">{label}</span>
			<span className="text-right font-medium capitalize">{value}</span>
		</div>
	);
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

function RunNotice({ kind, text }: { readonly kind: "error" | "ignored"; readonly text: string }) {
	return (
		<output
			className={`block rounded-lg border-2 border-foreground px-4 py-3 text-sm font-medium shadow-[3px_3px_0_var(--hard-shadow)] ${kind === "error" ? "bg-rose-200 text-rose-950 dark:bg-rose-950 dark:text-rose-100" : "bg-orange-200 text-orange-950 dark:bg-orange-950 dark:text-orange-100"}`}
		>
			{text}
		</output>
	);
}

function DetailSkeleton() {
	return (
		<output aria-label="Carregando detalhe" className="block space-y-4">
			<div className="grid grid-cols-2 gap-3">
				{Array.from({ length: 4 }, (_, index) => (
					<Skeleton className="h-24" key={index} />
				))}
			</div>
			<Skeleton className="h-52" />
			<Skeleton className="h-40" />
		</output>
	);
}
