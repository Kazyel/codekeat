import type { ReactNode } from "react";

export default function ConnectionsLoading(): ReactNode {
	return (
		<section aria-live="polite" className="connection-state-card">
			<p className="eyebrow">Integrações</p>
			<h1>Carregando conexões GitHub…</h1>
			<p>Consultando instalações e repositórios registrados.</p>
		</section>
	);
}
