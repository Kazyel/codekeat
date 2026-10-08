import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	CircleCheck,
	ExternalLink,
	GitBranch,
	Search,
	ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { EmptyState } from "@/components/content-states";
import { PageHeader } from "@/components/page-header";
import { ConnectionsIcon, ReviewIcon } from "@/components/product-icons";
import { QueryFeedback } from "@/components/query-feedback";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GitHubConnection } from "@/lib/api-contracts";
import { formatDateTime } from "@/lib/format";
import { connectionsQuery } from "@/lib/queries";

const connectionsSearchSchema = z.object({ q: z.string().optional() });
const REPOSITORIES_PER_PAGE = 12;

const installationLabels: Record<GitHubConnection["status"], string> = {
	active: "GitHub: ativa",
	suspended: "GitHub: suspensa",
	deleted: "GitHub: excluída",
};

const installationGuidance: Record<Exclude<GitHubConnection["status"], "active">, string> = {
	suspended:
		"Reviews indisponíveis. Peça ao responsável pela instalação para verificar a suspensão no GitHub e restabelecer o acesso.",
	deleted:
		"Reviews indisponíveis. Este registro é histórico; peça ao responsável pela conta para instalar o GitHub App novamente.",
};

export const Route = createFileRoute("/_dashboard/connections")({
	validateSearch: (search) => connectionsSearchSchema.catch({}).parse(search),
	loader: ({ context }) => context.queryClient.ensureQueryData(connectionsQuery),
	component: ConnectionsPage,
});

function visibleRepositories(
	connection: GitHubConnection,
	query: string,
): GitHubConnection["repositories"] {
	if (connection.accountLogin.toLowerCase().includes(query)) return connection.repositories;
	return connection.repositories.filter((repository) =>
		repository.fullName.toLowerCase().includes(query),
	);
}

function ConnectionsPage(): React.JSX.Element {
	const { data, isFetching, isRefetchError, refetch } = useSuspenseQuery(connectionsQuery);
	const { q = "" } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const query = q.trim().toLowerCase();
	const activeRepositories = data.reduce(
		(total, connection) =>
			total +
			(connection.status === "active" && connection.allowedByConfiguration
				? connection.repositories.filter((repository) => repository.status === "active")
						.length
				: 0),
		0,
	);
	const matches = data
		.map((connection) => ({ connection, repositories: visibleRepositories(connection, query) }))
		.filter(
			({ connection, repositories }) =>
				connection.accountLogin.toLowerCase().includes(query) || repositories.length > 0,
		);
	const setQuery = (value: string): void => {
		void navigate({ replace: true, resetScroll: false, search: { q: value || undefined } });
	};
	const applySearch = (event: React.SyntheticEvent<HTMLFormElement>): void => {
		event.preventDefault();
		const value = z.string().parse(new FormData(event.currentTarget).get("q"));
		setQuery(value.trim());
	};

	return (
		<div className="page-container">
			<PageHeader
				action={
					<div className="flex flex-wrap items-center gap-2">
						<QueryFeedback
							isFetching={isFetching}
							isRefetchError={isRefetchError}
							onRefresh={() => void refetch()}
						/>
						<a
							className={buttonVariants({ variant: "outline" })}
							href="https://github.com/settings/installations"
							rel="noopener noreferrer"
							target="_blank"
						>
							Gerenciar apps no GitHub
							<ExternalLink aria-hidden="true" />
							<span className="sr-only"> (abre em nova aba)</span>
						</a>
					</div>
				}
				description="Confira o acesso do GitHub App e o que precisa de atenção para receber reviews."
				eyebrow="Integração"
				title="Conexões GitHub"
			/>
			<section
				aria-label="Resumo das conexões"
				className="mb-8 grid grid-cols-2 gap-3 sm:gap-4"
			>
				<article className="relative overflow-hidden rounded-xl bg-primary p-4 text-primary-foreground shadow-[4px_4px_0_#8f0b18] sm:p-6">
					<div className="flex items-start justify-between gap-4">
						<h2 className="min-h-12 text-sm font-semibold sm:min-h-0">
							Instalações registradas
						</h2>
						<ConnectionsIcon
							aria-hidden="true"
							className="hidden size-8 shrink-0 sm:block"
						/>
					</div>
					<p className="mt-3 font-display text-4xl font-bold leading-none tracking-tight tabular-nums sm:text-5xl">
						{data.length}
					</p>
					<p className="mt-3 text-xs text-white/90 sm:text-sm">
						Inclui suspensas e excluídas.
					</p>
				</article>
				<article className="relative overflow-hidden rounded-xl bg-accent p-4 text-accent-foreground shadow-[4px_4px_0_#9a3412] sm:p-6">
					<div className="flex items-start justify-between gap-4">
						<h2 className="min-h-12 text-sm font-semibold sm:min-h-0">
							Repositórios com acesso a reviews
						</h2>
						<ReviewIcon
							aria-hidden="true"
							className="hidden size-8 shrink-0 sm:block"
						/>
					</div>
					<p className="mt-3 font-display text-4xl font-bold leading-none tracking-tight tabular-nums sm:text-5xl">
						{activeRepositories}
					</p>
					<p className="mt-3 text-xs sm:text-sm">
						Ativos no GitHub e permitidos no Codekeat.
					</p>
				</article>
			</section>
			<div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
				<div className="space-y-2">
					<h2 className="font-display text-2xl font-bold tracking-tight">
						Suas conexões
					</h2>
					<output aria-live="polite" className="block text-xs text-muted-foreground">
						{matches.length} de {data.length} instalações
						{q ? " · Busca aplicada; os totais acima não mudam." : null}
					</output>
				</div>
				<form
					className="flex flex-col gap-3 sm:flex-row sm:items-end lg:w-full lg:max-w-xl"
					onSubmit={applySearch}
				>
					<label className="block min-w-0 flex-1 space-y-2" htmlFor="connectionFilter">
						<span className="text-sm font-semibold">Buscar conta ou repositório</span>
						<span className="relative block">
							<Search
								aria-hidden="true"
								className="absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								id="connectionFilter"
								autoComplete="off"
								className="pl-9"
								name="q"
								defaultValue={q}
								key={q}
								placeholder="Ex.: minha-org ou minha-org/api"
								type="search"
							/>
						</span>
					</label>
					<Button className="h-11" type="submit">
						Buscar
					</Button>
					{q ? (
						<Button
							className="h-11"
							onClick={() => setQuery("")}
							type="button"
							variant="outline"
						>
							Limpar
						</Button>
					) : null}
				</form>
			</div>
			<ConnectionsList connections={data} matches={matches} />
		</div>
	);
}

function ConnectionsList({
	connections,
	matches,
}: {
	readonly connections: GitHubConnection[];
	readonly matches: {
		connection: GitHubConnection;
		repositories: GitHubConnection["repositories"];
	}[];
}): React.JSX.Element {
	if (connections.length === 0) {
		return (
			<EmptyState
				description="Peça ao responsável pela conta para instalar o GitHub App e conceder acesso aos repositórios. O link de gerenciamento acima mostra os apps já instalados no GitHub."
				title="Nenhuma instalação conectada"
			/>
		);
	}
	if (matches.length === 0) {
		return (
			<EmptyState
				description="Tente outro nome de conta ou repositório, ou limpe a busca para ver todas as instalações."
				title="Nenhuma conexão encontrada"
			/>
		);
	}
	return (
		<div className="space-y-5">
			{matches.map(({ connection, repositories }) => (
				<ConnectionCard
					connection={connection}
					key={connection.githubInstallationId}
					repositories={repositories}
				/>
			))}
		</div>
	);
}

function ConnectionCard({
	connection,
	repositories,
}: {
	readonly connection: GitHubConnection;
	readonly repositories: GitHubConnection["repositories"];
}): React.JSX.Element {
	const { q } = Route.useSearch();
	return (
		<article className="overflow-hidden rounded-xl border-2 border-[var(--hard-shadow)] bg-card shadow-[4px_4px_0_var(--hard-shadow)]">
			<header className="space-y-4 p-4 sm:p-5">
				<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
					<div className="flex min-w-0 items-center gap-3">
						<ConnectionsIcon
							aria-hidden="true"
							className="size-8 shrink-0 text-accent"
						/>
						<div className="min-w-0">
							<h3 className="font-display text-2xl font-bold [overflow-wrap:anywhere]">
								{connection.accountLogin}
							</h3>
							<p className="mt-1 text-xs text-muted-foreground">
								Instalação{" "}
								<span className="technical">
									#{connection.githubInstallationId}
								</span>
							</p>
						</div>
					</div>
					<ConnectionStatus connection={connection} />
				</div>
				{connection.status !== "active" ? (
					<p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
						{installationGuidance[connection.status]}
					</p>
				) : null}
				{!connection.allowedByConfiguration ? (
					<p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium">
						Reviews bloqueadas no Codekeat. Peça ao administrador do Codekeat para
						liberar esta instalação na configuração; alterar permissões no GitHub não
						remove esse bloqueio.
					</p>
				) : null}
			</header>
			<ConnectionRepositories connection={connection} key={q} repositories={repositories} />
			<footer className="bg-muted/30 px-5 py-3 text-xs text-muted-foreground sm:px-6">
				Atualizada em {formatDateTime(connection.updatedAt)}
			</footer>
		</article>
	);
}

function ConnectionRepositories({
	connection,
	repositories,
}: {
	readonly connection: GitHubConnection;
	readonly repositories: GitHubConnection["repositories"];
}): React.JSX.Element {
	const [expanded, setExpanded] = useState(false);
	const [pageIndex, setPageIndex] = useState(0);

	return (
		<details
			aria-label={`Repositórios de ${connection.accountLogin}`}
			className="group"
			onToggle={(event) => setExpanded(event.currentTarget.open)}
		>
			<summary className="control-motion flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 bg-muted/20 px-4 py-3 text-sm font-semibold hover:bg-accent/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5 [&::-webkit-details-marker]:hidden">
				<span className="flex flex-wrap items-center gap-2">
					<GitBranch aria-hidden="true" className="size-4 text-accent" />
					Repositórios
					<span className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums">
						{repositories.length} de {connection.repositories.length}
					</span>
				</span>
				<ChevronDown
					aria-hidden="true"
					className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
				/>
			</summary>
			{expanded ? (
				<RepositoryPage
					connection={connection}
					onPageChange={setPageIndex}
					pageIndex={pageIndex}
					repositories={repositories}
				/>
			) : null}
		</details>
	);
}

function RepositoryPage({
	connection,
	onPageChange,
	pageIndex,
	repositories,
}: {
	readonly connection: GitHubConnection;
	readonly onPageChange: (page: number) => void;
	readonly pageIndex: number;
	readonly repositories: GitHubConnection["repositories"];
}): React.JSX.Element {
	if (repositories.length === 0) {
		return (
			<p className="px-4 py-5 text-sm text-muted-foreground sm:px-5">
				Nenhum repositório registrado. Peça ao responsável pela instalação para verificar a
				seleção de repositórios e as permissões do app no GitHub.
			</p>
		);
	}

	const pageCount = Math.ceil(repositories.length / REPOSITORIES_PER_PAGE);
	const page = Math.min(pageIndex, pageCount - 1);
	const start = page * REPOSITORIES_PER_PAGE;
	const pageRepositories = repositories.slice(start, start + REPOSITORIES_PER_PAGE);
	const available = connection.status === "active" && connection.allowedByConfiguration;

	return (
		<div>
			<div className="flex flex-wrap items-center justify-between gap-3 border-y border-border bg-muted/20 px-4 py-3 sm:px-5">
				<output
					aria-atomic="true"
					aria-live="polite"
					className="text-xs text-muted-foreground"
				>
					<span className="block font-semibold tabular-nums text-foreground">
						{start + 1}–{start + pageRepositories.length} de {repositories.length}{" "}
						repositórios
					</span>
					<span className="mt-1 block tabular-nums">
						Página {page + 1} de {pageCount}
					</span>
				</output>
				<fieldset aria-label="Paginação dos repositórios" className="flex gap-2">
					<Button
						aria-label="Primeira página de repositórios"
						disabled={page === 0}
						onClick={() => onPageChange(0)}
						size="icon"
						variant="outline"
					>
						<ChevronsLeft aria-hidden="true" />
					</Button>
					<Button
						aria-label="Página anterior de repositórios"
						disabled={page === 0}
						onClick={() => onPageChange(page - 1)}
						size="icon"
						variant="outline"
					>
						<ChevronLeft aria-hidden="true" />
					</Button>
					<Button
						aria-label="Próxima página de repositórios"
						disabled={page === pageCount - 1}
						onClick={() => onPageChange(page + 1)}
						size="icon"
						variant="outline"
					>
						<ChevronRight aria-hidden="true" />
					</Button>
					<Button
						aria-label="Última página de repositórios"
						disabled={page === pageCount - 1}
						onClick={() => onPageChange(pageCount - 1)}
						size="icon"
						variant="outline"
					>
						<ChevronsRight aria-hidden="true" />
					</Button>
				</fieldset>
			</div>
			<ul
				aria-label={`Lista de repositórios de ${connection.accountLogin}`}
				className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3"
			>
				{pageRepositories.map((repository) => (
					<RepositoryRow
						available={available}
						key={repository.githubRepositoryId}
						repository={repository}
					/>
				))}
			</ul>
			{pageRepositories.some((repository) => repository.status === "removed") ? (
				<p className="border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
					Repositórios removidos não recebem reviews. Peça ao responsável para conferir a
					seleção e as permissões do app no GitHub.
				</p>
			) : null}
		</div>
	);
}

function RepositoryRow({
	available,
	repository,
}: {
	readonly available: boolean;
	readonly repository: GitHubConnection["repositories"][number];
}): React.JSX.Element {
	const removed = repository.status === "removed";
	return (
		<li className="control-motion grid min-w-0 grid-cols-[minmax(0,1fr)_auto] content-start gap-x-3 gap-y-1 rounded-lg bg-muted/30 p-3 hover:bg-muted/60">
			<p className="min-w-0 wrap-anywhere text-sm font-semibold" title={repository.fullName}>
				{repository.fullName.slice(repository.fullName.indexOf("/") + 1)}
			</p>
			<p className="row-start-2 flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
				<GitBranch aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
				<span className="min-w-0 wrap-anywhere">
					<span className="sr-only">Branch padrão: </span>
					<span className="technical">
						{repository.defaultBranch ?? "Branch indisponível"}
					</span>
				</span>
			</p>
			<div className="col-start-2 row-span-2 row-start-1 self-center justify-self-end">
				<RepositoryStatus available={available} removed={removed} />
			</div>
		</li>
	);
}

function RepositoryStatus({
	available,
	removed,
}: {
	readonly available: boolean;
	readonly removed: boolean;
}): React.JSX.Element {
	if (removed) return <Badge variant="secondary">Removido</Badge>;
	return (
		<Badge className="shrink-0" variant={available ? "default" : "secondary"}>
			{available ? "Acesso ativo" : "Review indisponível"}
		</Badge>
	);
}

function ConnectionStatus({
	connection,
}: {
	readonly connection: GitHubConnection;
}): React.JSX.Element {
	return (
		<div className="flex shrink-0 flex-wrap gap-2">
			<Badge variant="secondary">{installationLabels[connection.status]}</Badge>
			{connection.allowedByConfiguration ? (
				<Badge
					className="badge-edge-green bg-emerald-300! text-emerald-950! dark:bg-emerald-400!"
					variant="outline"
				>
					<CircleCheck aria-hidden="true" />
					Codekeat: permitida
				</Badge>
			) : (
				<Badge
					className="badge-edge-amber bg-amber-300! text-amber-950! dark:bg-amber-400!"
					variant="outline"
				>
					<ShieldAlert aria-hidden="true" />
					Codekeat: bloqueada
				</Badge>
			)}
		</div>
	);
}
