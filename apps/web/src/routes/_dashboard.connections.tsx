import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, CircleCheck, GitBranch, GitPullRequest, ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/content-states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { connectionsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_dashboard/connections")({
	loader: ({ context }) => context.queryClient.query(connectionsQuery),
	component: ConnectionsPage,
});

function ConnectionsPage() {
	const { data } = useSuspenseQuery(connectionsQuery);
	const activeRepositories = data
		.flatMap((connection) => connection.repositories)
		.filter((repository) => repository.status === "active").length;

	return (
		<div className="page-container">
			<PageHeader
				description="Instalações e repositórios observados pelo GitHub App."
				eyebrow="Integração"
				title="Conexões GitHub"
			/>
			<div className="mb-5 grid gap-4 sm:grid-cols-2">
				<article className="surface-panel p-5">
					<div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
						<Building2 aria-hidden="true" className="size-4 text-primary" />
						Instalações
					</div>
					<p className="metric-value">{data.length}</p>
				</article>
				<article className="surface-panel p-5">
					<div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
						<GitPullRequest aria-hidden="true" className="size-4 text-primary" />
						Repositórios ativos
					</div>
					<p className="metric-value">{activeRepositories}</p>
				</article>
			</div>
			{data.length === 0 ? (
				<EmptyState
					description="Instale o GitHub App em uma organização para começar a receber reviews."
					title="Nenhuma instalação conectada"
				/>
			) : (
				<div className="grid gap-5 xl:grid-cols-2">
					{data.map((connection) => (
						<Card className="overflow-hidden" key={connection.githubInstallationId}>
							<CardHeader className="flex-row items-start justify-between gap-4">
								<div>
									<div className="mb-2 flex items-center gap-2">
										<GitPullRequest
											aria-hidden="true"
											className="size-4 text-primary"
										/>
										<CardTitle>{connection.accountLogin}</CardTitle>
									</div>
									<p className="technical text-[11px] text-muted-foreground">
										installation/{connection.githubInstallationId}
									</p>
								</div>
								<ConnectionStatus
									allowed={connection.allowedByConfiguration}
									status={connection.status}
								/>
							</CardHeader>
							<CardContent>
								<div className="space-y-2">
									{connection.repositories.length === 0 ? (
										<p className="rounded-lg border-2 border-dashed border-foreground bg-card p-4 text-sm text-muted-foreground">
											Nenhum repositório visível.
										</p>
									) : (
										connection.repositories.map((repository) => (
											<div
												className="flex items-center gap-3 rounded-lg border-2 border-foreground bg-card px-3 py-3 shadow-[2px_2px_0_var(--hard-shadow)] transition-transform hover:-translate-y-0.5"
												key={repository.githubRepositoryId}
											>
												<GitBranch
													aria-hidden="true"
													className="size-4 shrink-0 text-muted-foreground"
												/>
												<div className="min-w-0 flex-1">
													<p className="truncate text-sm font-medium">
														{repository.fullName}
													</p>
													<p className="mt-0.5 text-[11px] text-muted-foreground">
														{repository.defaultBranch ??
															"branch padrão indisponível"}
													</p>
												</div>
												<Badge
													variant={
														repository.status === "active"
															? "default"
															: "secondary"
													}
												>
													{repository.status === "active"
														? "Ativo"
														: "Removido"}
												</Badge>
											</div>
										))
									)}
								</div>
								<p className="mt-4 text-[11px] text-muted-foreground">
									Atualizada em {formatDateTime(connection.updatedAt)}
								</p>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}

function ConnectionStatus({
	allowed,
	status,
}: {
	readonly allowed: boolean;
	readonly status: "active" | "suspended" | "deleted";
}) {
	if (!allowed) {
		return (
			<Badge
				className="badge-edge-amber bg-amber-300! text-amber-950! dark:bg-amber-400!"
				variant="outline"
			>
				<ShieldAlert aria-hidden="true" />
				Bloqueada na configuração
			</Badge>
		);
	}
	if (status === "active") {
		return (
			<Badge
				className="badge-edge-green bg-emerald-300! text-emerald-950! dark:bg-emerald-400!"
				variant="outline"
			>
				<CircleCheck aria-hidden="true" />
				Ativa
			</Badge>
		);
	}
	return <Badge variant="secondary">{status === "suspended" ? "Suspensa" : "Excluída"}</Badge>;
}
