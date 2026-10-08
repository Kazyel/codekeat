import { setTimeout } from "node:timers/promises";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { expect, it, vi } from "vitest";

import { DashboardShell } from "./dashboard-shell";
import { TooltipProvider } from "./ui/tooltip";

vi.mock("@/features/auth/auth.functions", () => ({ logoutFn: vi.fn() }));

it("keeps the collapse control focused and tooltip-free in both sidebar states", async () => {
	const container = document.createElement("div");
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	document.body.append(container);
	const root = createRoot(container);
	const client = new QueryClient();
	const route = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<TooltipProvider delay={0}>
					<DashboardShell
						user={{
							id: "00000000-0000-4000-8000-000000000001",
							email: "design@example.invalid",
							role: "member",
						}}
					>
						<h1>Visão geral</h1>
					</DashboardShell>
				</TooltipProvider>
			</QueryClientProvider>
		),
	});
	const router = createRouter({
		routeTree: route,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	try {
		await act(async () => {
			root.render(<RouterProvider router={router} />);
		});
		const button = container.querySelector<HTMLButtonElement>(".sidebar-toggle");
		if (!button) throw new Error("Sidebar toggle missing");
		await act(async () => {
			button.focus();
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
		});
		expect(button.getAttribute("aria-expanded")).toBe("true");
		expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
		await act(async () => {
			button.click();
		});
		expect(button.getAttribute("aria-expanded")).toBe("false");
		await act(async () => {
			button.blur();
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
			button.focus();
		});
		await act(async () => {
			await setTimeout(0);
		});
		expect(document.activeElement).toBe(button);
		expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
		await act(async () => {
			button.click();
		});
		expect(button.getAttribute("aria-expanded")).toBe("true");
		expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
	} finally {
		await act(async () => {
			root.unmount();
		});
		client.clear();
		container.remove();
		scrollTo.mockRestore();
		vi.unstubAllGlobals();
	}
});
