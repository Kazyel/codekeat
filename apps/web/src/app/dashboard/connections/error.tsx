"use client";

import type { ReactNode } from "react";

export default function ConnectionsError({
	retry,
}: {
	readonly error: unknown;
	readonly reset: () => void;
	readonly retry: () => void;
}): ReactNode {
	return (
		<section className="connection-state-card connection-error" role="alert">
			<p className="eyebrow">Integrações</p>
			<h2>Não foi possível carregar as conexões GitHub</h2>
			<p>Tente novamente para consultar o estado mais recente.</p>
			<button className="primary-button" onClick={retry} type="button">
				Tentar novamente
			</button>
		</section>
	);
}
