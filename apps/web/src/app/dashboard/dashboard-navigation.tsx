"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function DashboardNavigation(): ReactNode {
	const pathname = usePathname();
	const analysesCurrent = pathname === "/dashboard" || pathname.startsWith("/dashboard/reviews/");
	const connectionsCurrent =
		pathname === "/dashboard/connections" || pathname.startsWith("/dashboard/connections/");
	const modelsCurrent =
		pathname === "/dashboard/models" || pathname.startsWith("/dashboard/models/");

	return (
		<nav aria-label="Principal" className="dashboard-navigation">
			<Link aria-current={analysesCurrent ? "page" : undefined} href="/dashboard">
				Análises
			</Link>
			<Link
				aria-current={connectionsCurrent ? "page" : undefined}
				href="/dashboard/connections"
			>
				Conexões
			</Link>
			<Link aria-current={modelsCurrent ? "page" : undefined} href="/dashboard/models">
				Modelos
			</Link>
		</nav>
	);
}
