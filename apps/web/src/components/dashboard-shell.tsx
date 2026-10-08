import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, SunMoon } from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import {
	AnalyticsIcon,
	ConnectionsIcon,
	ModelsIcon,
	OverviewIcon,
	ReviewIcon,
} from "@/components/product-icons";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { logoutFn } from "@/features/auth/auth.functions";
import type { DashboardUser } from "@/lib/api-contracts";
import { cn } from "@/lib/utils";

const navigation = [
	{ to: "/", label: "Visão geral", icon: OverviewIcon },
	{ to: "/reviews", label: "Reviews", icon: ReviewIcon },
	{ to: "/analytics", label: "Analytics", icon: AnalyticsIcon },
	{ to: "/connections", label: "Conexões", icon: ConnectionsIcon },
	{ to: "/models", label: "Modelos", icon: ModelsIcon },
] as const;

export function DashboardShell({
	user,
	children,
}: {
	readonly user: DashboardUser;
	readonly children: React.ReactNode;
}) {
	const [collapsed, setCollapsed] = useState(false);

	return (
		<div className="app-layout" data-sidebar-collapsed={collapsed}>
			<a
				className="fixed left-4 top-4 z-[100] -translate-y-20 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform focus:translate-y-0"
				href="#main-content"
			>
				Pular para o conteúdo
			</a>
			<aside className="app-sidebar" id="dashboard-sidebar">
				<div
					className={cn(
						"mb-8 flex h-12 shrink-0 items-center justify-between",
						collapsed && "justify-center",
					)}
				>
					{collapsed ? null : <Brand />}
					<Button
						aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
						aria-expanded={!collapsed}
						aria-controls="dashboard-sidebar"
						className="sidebar-toggle"
						onClick={() => setCollapsed((current) => !current)}
						size="icon"
						variant="ghost"
					>
						{collapsed ? (
							<PanelLeftOpen aria-hidden="true" className="size-5" />
						) : (
							<PanelLeftClose aria-hidden="true" className="size-5" />
						)}
					</Button>
				</div>
				<div className="sidebar-navigation min-h-0 flex-1 overflow-y-auto p-1 -m-1">
					<Navigation collapsed={collapsed} inverted />
				</div>
				<div className="shrink-0 pt-6">
					<UserMenu compact={collapsed} user={user} />
				</div>
			</aside>
			<MobileHeader user={user} />
			<main className="app-main" id="main-content" tabIndex={-1}>
				{children}
			</main>
		</div>
	);
}

function Brand() {
	return (
		<Link aria-label="Codekeat — visão geral" className="flex shrink-0" to="/">
			<BrandMark className="size-12" />
		</Link>
	);
}

function Navigation({
	collapsed = false,
	onNavigate,
	inverted = false,
}: {
	readonly collapsed?: boolean;
	readonly onNavigate?: () => void;
	readonly inverted?: boolean;
}) {
	return (
		<nav aria-label="Principal" className={inverted ? "space-y-1" : "space-y-2"}>
			{navigation.map(({ to, label, icon: Icon }) => {
				const link = (
					<Link
						activeProps={{
							className:
								"border-primary bg-primary text-white [--icon-fill-opacity:0.4]",
						}}
						aria-label={collapsed ? label : undefined}
						className={cn(
							"product-nav-link control-motion flex items-center gap-3 overflow-hidden rounded-lg px-3 text-sm font-medium",
							collapsed && "justify-center px-0",
							inverted
								? "h-11 border-2 border-transparent text-muted-foreground"
								: "h-12 font-semibold text-foreground",
						)}
						key={to}
						onClick={onNavigate}
						to={to}
					>
						<Icon className="size-5 shrink-0" />
						<span className={cn("shrink-0", collapsed && "sr-only")}>{label}</span>
					</Link>
				);

				if (!collapsed) return link;

				return (
					<Tooltip key={to}>
						<TooltipTrigger render={link} />
						<TooltipContent side="right">{label}</TooltipContent>
					</Tooltip>
				);
			})}
		</nav>
	);
}

function MobileHeader({ user }: { readonly user: DashboardUser }) {
	const [open, setOpen] = useState(false);
	return (
		<header className="mobile-header">
			<div className="flex items-center gap-2">
				<BrandMark className="size-7" />
				<span className="text-sm font-semibold">Codekeat</span>
			</div>
			<div className="flex items-center gap-2">
				<UserMenu compact user={user} />
				<Sheet onOpenChange={setOpen} open={open}>
					<SheetTrigger
						render={<Button aria-label="Abrir navegação" size="icon" variant="ghost" />}
					>
						<Menu aria-hidden="true" />
					</SheetTrigger>
					<SheetContent
						className="w-[calc(100%-3rem)] rounded-l-2xl shadow-[-4px_4px_0_var(--control-edge)] sm:w-full"
						side="right"
					>
						<SheetHeader>
							<BrandMark className="mb-2 size-12" />
							<SheetTitle>Codekeat</SheetTitle>
							<SheetDescription>Navegação do workspace</SheetDescription>
						</SheetHeader>
						<div className="sheet-body">
							<Navigation onNavigate={() => setOpen(false)} />
						</div>
					</SheetContent>
				</Sheet>
			</div>
		</header>
	);
}

function UserMenu({
	user,
	compact = false,
}: {
	readonly user: DashboardUser;
	readonly compact?: boolean;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const label = user.email.split("@")[0] ?? user.email;
	const handleLogout = async () => {
		await logoutFn();
		queryClient.clear();
		await router.navigate({ to: "/login" });
	};
	const toggleTheme = () => {
		const root = document.documentElement;
		const nextTheme = root.classList.contains("dark") ? "light" : "dark";
		root.classList.toggle("dark", nextTheme === "dark");
		try {
			localStorage.setItem("codekeat-theme", nextTheme);
		} catch {
			// Theme still changes when storage is unavailable.
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={compact ? `Menu de ${label}` : undefined}
						className={cn(
							"profile-trigger text-sidebar-foreground",
							compact
								? "size-11 justify-center p-0"
								: "h-auto w-full justify-between p-3",
						)}
						variant="ghost"
					/>
				}
			>
				<span className="flex min-w-0 items-center gap-3">
					<span
						className={cn(
							"grid shrink-0 place-items-center rounded-full border-2 border-[var(--accent)] bg-[#f7f5f1] text-sm font-bold uppercase text-[#171719] shadow-[3px_3px_0_var(--accent)]",
							compact ? "size-8" : "size-10",
						)}
					>
						{label.charAt(0)}
					</span>
					{compact ? null : (
						<span className="min-w-0 text-left">
							<span className="block truncate text-sm font-semibold">{label}</span>
							<span className="block text-xs font-medium capitalize text-muted-foreground">
								{user.role}
							</span>
						</span>
					)}
				</span>
				{compact ? null : (
					<ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align={compact ? "end" : "start"}
				className="w-60"
				side={compact ? "bottom" : "top"}
				sideOffset={12}
			>
				<div className="px-2 py-1.5">
					<p className="truncate text-sm font-semibold">{user.email}</p>
					<p className="text-xs font-medium capitalize text-muted-foreground">
						{user.role}
					</p>
				</div>
				<DropdownMenuItem onClick={toggleTheme}>
					<SunMoon aria-hidden="true" /> Alternar tema
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleLogout}>
					<LogOut aria-hidden="true" /> Sair
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
