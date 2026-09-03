import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BrandLockup } from "../brand-lockup";
import { readSession } from "../lib/session";
import { DashboardNavigation } from "./dashboard-navigation";

export default async function DashboardLayout({
	children,
}: Readonly<{ children: ReactNode }>): Promise<ReactNode> {
	const session = await readSession();
	if (session === null) {
		redirect("/login");
	}

	return (
		<div className="shell">
			<header className="masthead">
				<BrandLockup />
				<DashboardNavigation />
				<div className="dashboard-account">
					<span>{session.email}</span>
					<form action="/logout" method="post">
						<button className="quiet-button" type="submit">
							Sair
						</button>
					</form>
				</div>
			</header>
			<main>{children}</main>
		</div>
	);
}
