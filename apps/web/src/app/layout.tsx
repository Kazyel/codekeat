import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./styles.css";

export const metadata: Metadata = {
	title: "Codekeat | Revisão consultiva",
	description: "Relatórios consultivos de pull requests.",
	icons: {
		icon: "/codekeat.svg",
	},
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
	return (
		<html lang="pt-BR">
			<body>{children}</body>
		</html>
	);
}
