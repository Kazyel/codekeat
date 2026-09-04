import { useEffect, useState } from "react";

import type { QueryClient } from "@tanstack/react-query";
import { Dithering } from "@paper-design/shaders-react";
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "../styles.css?url";
const themeScript = `
try {
	const storedTheme = localStorage.getItem("codekeat-theme");
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	document.documentElement.classList.toggle(
		"dark",
		storedTheme === "dark" || (storedTheme !== "light" && prefersDark),
	);
} catch {}
`;

interface RouterContext {
	readonly queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ name: "theme-color", content: "#171719" },
			{ title: "Codekeat · Inteligência de reviews" },
			{
				name: "description",
				content: "Operação e inteligência das reviews consultivas do Codekeat.",
			},
		],
		links: [
			{ rel: "preconnect", href: "https://api.fontshare.com" },
			{ rel: "preconnect", href: "https://cdn.fontshare.com", crossOrigin: "anonymous" },
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{ rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400..700&display=swap",
			},
			{
				rel: "stylesheet",
				href: "https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&display=swap",
			},
			{ rel: "icon", href: "/codekeat.svg", type: "image/svg+xml" },
			{ rel: "stylesheet", href: appCss },
		],
	}),
	notFoundComponent: NotFound,
	component: RootComponent,
	shellComponent: RootDocument,
});

function ThemeDithering() {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		const root = document.documentElement;
		const syncTheme = () => setIsDark(root.classList.contains("dark"));
		const observer = new MutationObserver(syncTheme);

		syncTheme();
		observer.observe(root, { attributeFilter: ["class"], attributes: true });

		return () => observer.disconnect();
	}, []);

	return (
		<Dithering
			aria-hidden="true"
			className="app-dither"
			colorBack={isDark ? "#070707" : "#f2f2ef"}
			colorFront={isDark ? "#fc6701" : "#171719"}
			maxPixelCount={1_500_000}
			scale={0.75}
			shape="swirl"
			size={2}
			speed={0}
			type="8x8"
		/>
	);
}

function RootComponent() {
	return (
		<TooltipProvider>
			<ThemeDithering />
			<div className="relative min-h-svh">
				<Outlet />
			</div>
			<Toaster position="bottom-right" richColors />
		</TooltipProvider>
	);
}

function RootDocument({ children }: { readonly children: React.ReactNode }) {
	return (
		<html lang="pt-BR" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}

function NotFound() {
	return (
		<main className="grid min-h-svh place-items-center px-6 text-center">
			<div>
				<p className="eyebrow">Erro 404</p>
				<h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em]">
					Página não encontrada
				</h1>
				<p className="mt-3 text-sm text-muted-foreground">
					O endereço não pertence ao dashboard.
				</p>
				<Button className="mt-6" render={<Link to="/" />}>
					Voltar à visão geral
				</Button>
			</div>
		</main>
	);
}
