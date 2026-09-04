import { QueryClient } from "@tanstack/react-query";
import { createRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ErrorState, PanelSkeleton } from "@/components/content-states";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { staleTime: 30_000, retry: 1 },
		},
	});
	const router = createRouter({
		routeTree,
		context: { queryClient },
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPendingComponent: RoutePending,
		defaultErrorComponent: RouteError,
	});

	setupRouterSsrQueryIntegration({ router, queryClient });
	return router;
}

function RoutePending() {
	return (
		<div className="page-container" aria-label="Carregando página">
			<PanelSkeleton rows={5} />
		</div>
	);
}

function RouteError({ reset }: ErrorComponentProps) {
	return (
		<div className="page-container">
			<ErrorState
				description="A rota não respondeu como esperado. Tente carregar os dados novamente."
				onRetry={reset}
			/>
		</div>
	);
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
