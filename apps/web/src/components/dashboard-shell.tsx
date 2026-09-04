import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import {
	BarChart3,
	BrainCircuit,
	ChevronDown,
	GitBranch,
	GitPullRequestArrow,
	LayoutDashboard,
	LogOut,
	Menu,
	PanelLeftClose,
	PanelLeftOpen,
	SunMoon,
} from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { logoutFn } from "@/features/auth/auth.functions";
import type { DashboardUser } from "@/lib/api-contracts";
import { cn } from "@/lib/utils";

const navigation = [
	{ to: "/", label: "Visão geral", icon: LayoutDashboard },
	{ to: "/reviews", label: "Reviews", icon: GitPullRequestArrow },
	{ to: "/analytics", label: "Analytics", icon: BarChart3 },
	{ to: "/connections", label: "Conexões", icon: GitBranch },
	{ to: "/models", label: "Modelos", icon: BrainCircuit },
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
			<aside className="app-sidebar">
				<div
					className={cn(
						"mb-8 flex h-12 items-center justify-between",
						collapsed && "justify-center",
					)}
				>
					{collapsed ? null : <Brand />}
					<Button
						aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
						aria-pressed={collapsed}
						className="sidebar-toggle border-[#171719] bg-white text-[#171719] shadow-[2px_2px_0_#fc6701]"
						onClick={() => setCollapsed((current) => !current)}
						size="icon-sm"
						variant="outline"
					>
						{collapsed ? (
							<PanelLeftOpen aria-hidden="true" />
						) : (
							<PanelLeftClose aria-hidden="true" />
						)}
					</Button>
				</div>
				<Navigation collapsed={collapsed} inverted />
				<div className="mt-auto">
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
		<nav aria-label="Principal" className="space-y-1">
			{navigation.map(({ to, label, icon: Icon }) => {
				const link = (
					<Link
						activeProps={{
							className: "border-primary bg-primary text-white",
						}}
						aria-label={collapsed ? label : undefined}
						className={cn(
							"flex h-10 items-center gap-3 overflow-hidden rounded-lg border-2 border-transparent px-3 text-sm transition-colors duration-150 hover:border-white/20 hover:bg-white/10",
							collapsed && "justify-center px-0",
							inverted
								? "text-[#a8a8aa] hover:text-white"
								: "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
						)}
						key={to}
						onClick={onNavigate}
						to={to}
					>
						<Icon aria-hidden="true" className="size-4 shrink-0" />
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
						className="w-72 border-l-2! border-foreground bg-sidebar p-5 text-sidebar-foreground [&_[data-slot=sheet-close]]:text-white"
						side="right"
					>
						<SheetTitle className="mb-7 flex items-center gap-3 text-white">
							<BrandMark /> Codekeat
						</SheetTitle>
						<Navigation inverted onNavigate={() => setOpen(false)} />
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
						className={cn(
							"profile-trigger h-auto w-full justify-between py-2 pr-2 pl-0 text-white",
							compact && "size-9 p-0",
						)}
						variant="ghost"
					/>
				}
			>
				<span className="flex min-w-0 items-center gap-3">
					<span
						className={cn(
							"grid shrink-0 place-items-center rounded-full border-2 border-[#171719] bg-[#f7f5f1] text-sm font-bold uppercase text-[#171719] shadow-[3px_3px_0_#fc6701]",
							compact ? "size-9" : "size-10",
						)}
					>
						{label.charAt(0)}
					</span>
					{compact ? null : (
						<span className="min-w-0 text-left">
							<span className="block truncate text-sm font-semibold">{label}</span>
							<span className="block text-xs font-medium capitalize text-[#b9b9bb]">
								{user.role}
							</span>
						</span>
					)}
				</span>
				{compact ? null : (
					<ChevronDown aria-hidden="true" className="size-3.5 text-[#a8a8aa]" />
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<div className="px-2 py-1.5">
					<p className="truncate text-sm font-semibold">{user.email}</p>
					<p className="text-xs font-medium capitalize text-muted-foreground">
						{user.role}
					</p>
				</div>
				<Separator className="my-1" />
				<DropdownMenuItem
					className="dark:focus:border-white/70 dark:focus:bg-accent/20 dark:focus:text-white dark:focus:shadow-[3px_3px_0_#fc6701] dark:focus:[&_svg]:text-accent! dark:focus:[&_svg_*]:text-accent!"
					onClick={toggleTheme}
				>
					<SunMoon aria-hidden="true" /> Alternar tema
				</DropdownMenuItem>
				<DropdownMenuItem
					className="dark:focus:border-white/70 dark:focus:bg-accent/20 dark:focus:text-white dark:focus:shadow-[3px_3px_0_#fc6701] dark:focus:[&_svg]:text-accent! dark:focus:[&_svg_*]:text-accent!"
					onClick={handleLogout}
				>
					<LogOut aria-hidden="true" /> Sair
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
