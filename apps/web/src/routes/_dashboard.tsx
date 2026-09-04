import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentUserFn } from "@/features/auth/auth.functions";

export const Route = createFileRoute("/_dashboard")({
	beforeLoad: async () => {
		const user = await getCurrentUserFn();
		if (user === null) throw redirect({ to: "/login" });
		return { user };
	},
	component: DashboardLayout,
});

function DashboardLayout() {
	const { user } = Route.useRouteContext();
	return (
		<DashboardShell user={user}>
			<Outlet />
		</DashboardShell>
	);
}
