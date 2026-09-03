import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { type DashboardGitHubConnection, loadGitHubConnections } from "../../lib/api-client";
import { readSession } from "../../lib/session";
import { LocalDateTime } from "../../review-usage";

type InstallationStatus = DashboardGitHubConnection["status"];
type RepositoryAccess = DashboardGitHubConnection["repositories"][number];
type StatusTone = "low" | "medium" | "muted";

interface StatusPresentation {
	readonly label: string;
	readonly tone: StatusTone;
}

const INSTALLATION_STATUS: Readonly<Record<InstallationStatus, StatusPresentation>> = {
	active: { label: "Ativa", tone: "low" },
	suspended: { label: "Suspensa", tone: "medium" },
	deleted: { label: "Desinstalada", tone: "muted" },
};
const REPOSITORY_STATUS: Readonly<Record<RepositoryAccess["status"], StatusPresentation>> = {
	active: { label: "Ativo", tone: "low" },
	removed: { label: "Removido", tone: "muted" },
};
const ALLOWED_CONFIGURATION_STATUS: StatusPresentation = {
	label: "Permitida pela configuração",
	tone: "low",
};
const OUTSIDE_CONFIGURATION_STATUS: StatusPresentation = {
	label: "Fora de ALLOWED_GITHUB_ACCOUNTS",
	tone: "medium",
};

export default async function ConnectionsPage(): Promise<ReactNode> {
	const session = await readSession();
	if (session === null) {
		redirect("/login");
	}

	const connections = await loadGitHubConnections();
	return (
		<>
			<header className="content-header">
				<p className="eyebrow">Integrações</p>
				<h1>Conexões GitHub</h1>
			</header>

			{connections.length === 0 ? (
				<section className="empty-state">
					<h2>Nenhuma conexão registrada</h2>
					<p>
						Uma instalação permitida do GitHub App aparecerá aqui depois que seu webhook
						for recebido.
					</p>
				</section>
			) : (
				<section aria-label="Conexões GitHub" className="connection-list">
					{connections.map((connection) => (
						<ConnectionCard
							connection={connection}
							key={connection.githubInstallationId}
						/>
					))}
				</section>
			)}
		</>
	);
}

function ConnectionCard({
	connection,
}: {
	readonly connection: DashboardGitHubConnection;
}): ReactNode {
	const installationStatus = INSTALLATION_STATUS[connection.status];
	const configurationStatus = connection.allowedByConfiguration
		? ALLOWED_CONFIGURATION_STATUS
		: OUTSIDE_CONFIGURATION_STATUS;

	return (
		<article className="connection-card">
			<header className="connection-card-heading">
				<div>
					<p className="eyebrow">Conta GitHub</p>
					<h2>{connection.accountLogin}</h2>
				</div>
				<div aria-label="Estado da instalação" className="status-badges">
					<StatusBadge presentation={installationStatus} />
					<StatusBadge presentation={configurationStatus} />
				</div>
			</header>

			<dl className="connection-facts">
				<div>
					<dt>Última atualização da instalação</dt>
					<dd>
						<LocalDateTime value={connection.updatedAt} />
					</dd>
				</div>
			</dl>

			<section
				className="repository-access"
				aria-label={`Repositórios de ${connection.accountLogin}`}
			>
				<h3>Repositórios</h3>
				{connection.repositories.length === 0 ? (
					<p className="connection-empty">
						Nenhum repositório registrado nesta instalação.
					</p>
				) : (
					<ul className="repository-list">
						{connection.repositories.map((repository) => (
							<RepositoryAccessItem
								key={repository.githubRepositoryId}
								repository={repository}
							/>
						))}
					</ul>
				)}
			</section>
		</article>
	);
}

function RepositoryAccessItem({
	repository,
}: {
	readonly repository: RepositoryAccess;
}): ReactNode {
	return (
		<li>
			<div className="repository-heading">
				<strong>{repository.fullName}</strong>
				<StatusBadge presentation={REPOSITORY_STATUS[repository.status]} />
			</div>
			<dl className="repository-facts">
				<div>
					<dt>Branch padrão</dt>
					<dd>
						{repository.defaultBranch === null ? (
							"Branch padrão ainda não conhecida"
						) : (
							<code>{repository.defaultBranch}</code>
						)}
					</dd>
				</div>
				<div>
					<dt>Última atualização</dt>
					<dd>
						<LocalDateTime value={repository.updatedAt} />
					</dd>
				</div>
			</dl>
		</li>
	);
}

function StatusBadge({ presentation }: { readonly presentation: StatusPresentation }): ReactNode {
	return (
		<span className={`status-badge status-badge-${presentation.tone}`}>
			{presentation.label}
		</span>
	);
}
