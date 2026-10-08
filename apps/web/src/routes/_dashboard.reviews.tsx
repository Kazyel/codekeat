import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	createColumnHelper,
	createPaginatedRowModel,
	createSortedRowModel,
	rowPaginationFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_datetime,
	tableFeatures,
	useTable,
	type SortingState,
} from "@tanstack/react-table";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	PanelRightOpen,
	Search,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { ReviewDetailDrawer } from "@/features/reviews/review-detail-drawer";
import { EmptyState } from "@/components/content-states";
import { PageHeader } from "@/components/page-header";
import { ExecutionIcon, ReviewIcon } from "@/components/product-icons";
import { QueryFeedback } from "@/components/query-feedback";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { reviewRunSummarySchema, type ReviewRunSummary } from "@/lib/api-contracts";
import { getReviewsPagination, reviewsSearchSchema } from "@/features/reviews/reviews-search";
import { formatDateTime, formatUsdMicros } from "@/lib/format";
import { reviewRunsQuery } from "@/lib/queries";

const defaultSorting: SortingState = [{ id: "createdAt", desc: true }];
const reviewsDescription =
	"Encontre um pull request, acompanhe a execução e confira os findings. Histórico das 50 reviews mais recentes.";

const features = tableFeatures({
	rowPaginationFeature,
	rowSortingFeature,
	paginatedRowModel: createPaginatedRowModel(),
	sortedRowModel: createSortedRowModel(),
	sortFns: { alphanumeric: sortFn_alphanumeric, datetime: sortFn_datetime },
});
const columnHelper = createColumnHelper<typeof features, ReviewRunSummary>();
const columns = columnHelper.columns([
	columnHelper.accessor("repositoryFullName", {
		header: "Repositório",
		cell: ({ row }) => (
			<div className="max-w-[22rem] whitespace-normal [overflow-wrap:anywhere]">
				<Link
					aria-label={`Abrir review do PR #${row.original.pullRequestNumber} em ${row.original.repositoryFullName}`}
					className="control-motion rounded-sm font-semibold underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
					resetScroll={false}
					search={(previous) => ({ ...previous, reviewRunId: row.original.id })}
					to="/reviews"
				>
					{row.original.repositoryFullName}
				</Link>
				<p className="mt-1 text-xs text-muted-foreground sm:hidden">
					PR #{row.original.pullRequestNumber}
				</p>
			</div>
		),
	}),
	columnHelper.accessor("pullRequestNumber", {
		header: "PR",
		cell: ({ row }) => (
			<span className="technical text-muted-foreground">
				#{row.original.pullRequestNumber}
			</span>
		),
	}),
	columnHelper.accessor("status", {
		header: "Status",
		cell: ({ row }) => <StatusBadge status={row.original.status} />,
	}),
	columnHelper.accessor("findingCount", {
		header: "Findings",
		cell: ({ row }) => (
			<span className="font-semibold tabular-nums">{row.original.findingCount}</span>
		),
	}),
	columnHelper.display({
		id: "cost",
		header: "Custo",
		cell: ({ row }) => (
			<span className="tabular-nums text-muted-foreground">
				{row.original.usage
					? formatUsdMicros(
							row.original.usage.costUsdMicros +
								(row.original.judgeUsage?.costUsdMicros ?? 0),
						)
					: "—"}
			</span>
		),
	}),
	columnHelper.accessor("createdAt", {
		header: "Criada em",
		cell: ({ row }) => (
			<span className="whitespace-nowrap text-sm text-muted-foreground">
				{formatDateTime(row.original.createdAt)}
			</span>
		),
	}),
	columnHelper.display({
		id: "actions",
		header: "Detalhes",
		cell: ({ row }) => (
			<Button
				aria-label={`Ver detalhes do PR #${row.original.pullRequestNumber} em ${row.original.repositoryFullName}`}
				render={
					<Link
						resetScroll={false}
						search={(previous) => ({ ...previous, reviewRunId: row.original.id })}
						to="/reviews"
					/>
				}
				size="sm"
				variant="outline"
			>
				<PanelRightOpen aria-hidden="true" />
				Ver detalhes
			</Button>
		),
	}),
]);

export const Route = createFileRoute("/_dashboard/reviews")({
	validateSearch: (search) => reviewsSearchSchema.parse(search),
	loader: ({ context }) => context.queryClient.ensureQueryData(reviewRunsQuery),
	pendingComponent: ReviewsPending,
	component: ReviewsPage,
});

function ReviewsPage(): React.JSX.Element {
	const { data, isFetching, isRefetchError, refetch } = useSuspenseQuery(reviewRunsQuery);
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const searchInput = useRef<HTMLInputElement>(null);
	const query = search.q ?? "";
	const statusFilter = search.status ?? "all";
	const sorting = search.sort ?? defaultSorting;
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (normalized.length === 0 && statusFilter === "all") return data;
		return data.filter(
			(run) =>
				(statusFilter === "all" || run.status === statusFilter) &&
				`${run.repositoryFullName} #${run.pullRequestNumber} ${run.status}`
					.toLowerCase()
					.includes(normalized),
		);
	}, [data, query, statusFilter]);
	const pagination = useMemo(
		() => getReviewsPagination(search.page, filtered.length),
		[search.page, filtered.length],
	);
	const page = pagination.pageIndex + 1;
	useEffect(() => {
		if (search.page === undefined || search.page === page) return;
		void navigate({
			replace: true,
			resetScroll: false,
			search: (previous) =>
				previous.page === search.page ? { ...previous, page } : previous,
		});
	}, [navigate, page, search.page]);
	useEffect(() => {
		const focusSearch = (event: KeyboardEvent) => {
			if (
				event.key !== "/" ||
				event.defaultPrevented ||
				event.isComposing ||
				event.repeat ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.shiftKey
			)
				return;
			if (document.querySelector("dialog[open], [role='dialog'], [role='alertdialog']"))
				return;
			const editing = event
				.composedPath()
				.some(
					(target) =>
						target instanceof HTMLElement &&
						(target.isContentEditable ||
							target.closest(
								"input, textarea, select, [role='textbox'], [role='combobox'], [role='listbox']",
							)),
				);
			if (editing) return;
			event.preventDefault();
			searchInput.current?.focus({ preventScroll: true });
		};
		document.addEventListener("keydown", focusSearch);
		return () => document.removeEventListener("keydown", focusSearch);
	}, []);
	const inProgress = data.reduce(
		(total, run) => total + (run.status === "queued" || run.status === "running" ? 1 : 0),
		0,
	);
	const table = useTable(
		{
			features,
			columns,
			data: filtered,
			autoResetPageIndex: false,
			state: { sorting, pagination },
			onSortingChange: (updater) => {
				void navigate({
					resetScroll: false,
					search: (previous) => ({
						...previous,
						sort: reviewsSearchSchema.shape.sort.parse(
							typeof updater === "function"
								? updater(previous.sort ?? defaultSorting)
								: updater,
						),
						page: 1,
					}),
				});
			},
			onPaginationChange: (updater) => {
				void navigate({
					resetScroll: false,
					search: (previous) => {
						const current = getReviewsPagination(previous.page, filtered.length);
						const next = typeof updater === "function" ? updater(current) : updater;
						return { ...previous, page: next.pageIndex + 1 };
					},
				});
			},
		},
		(state) => ({ pagination: state.pagination, sorting: state.sorting }),
	);
	const setDetailOpen = (open: boolean) => {
		if (open) return;
		void navigate({
			replace: true,
			resetScroll: false,
			search: (previous) => ({ ...previous, reviewRunId: undefined }),
		});
	};

	return (
		<div className="page-container">
			<PageHeader description={reviewsDescription} eyebrow="Operação" title="Reviews" />
			<section
				aria-label="Resumo das reviews"
				className="mb-8 grid grid-cols-2 gap-3 sm:gap-4"
			>
				<article className="rounded-xl bg-primary p-4 text-primary-foreground shadow-[4px_4px_0_#8f0b18] sm:p-6">
					<div className="flex items-start justify-between gap-3">
						<h2 className="text-sm font-semibold">Reviews recentes</h2>
						<ReviewIcon
							aria-hidden="true"
							className="hidden size-8 shrink-0 sm:block"
						/>
					</div>
					<p className="mt-3 font-display text-4xl font-bold leading-none tabular-nums sm:text-5xl">
						{data.length}
					</p>
					<p className="mt-3 text-xs sm:text-sm">Execuções neste histórico.</p>
				</article>
				<article className="rounded-xl bg-accent p-4 text-accent-foreground shadow-[4px_4px_0_#9a3412] sm:p-6">
					<div className="flex items-start justify-between gap-3">
						<h2 className="text-sm font-semibold">Em andamento</h2>
						<ExecutionIcon
							aria-hidden="true"
							className="hidden size-8 shrink-0 sm:block"
						/>
					</div>
					<p className="mt-3 font-display text-4xl font-bold leading-none tabular-nums sm:text-5xl">
						{inProgress}
					</p>
					<p className="mt-3 text-xs sm:text-sm">Na fila ou em execução.</p>
				</article>
			</section>
			<div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
				<div className="space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="font-display text-2xl font-bold tracking-tight">
							Histórico de reviews
						</h2>
						<QueryFeedback
							isFetching={isFetching}
							isRefetchError={isRefetchError}
							onRefresh={() => void refetch()}
						/>
					</div>
					<output aria-live="polite" className="block text-xs text-muted-foreground">
						{filtered.length} de {data.length} reviews
					</output>
				</div>
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] lg:w-full lg:max-w-2xl">
					<label className="block min-w-0 space-y-2" htmlFor="reviewFilter">
						<span className="flex items-center justify-between gap-3 text-sm font-semibold">
							Buscar repositório ou PR
							<kbd
								aria-hidden="true"
								className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground"
							>
								/
							</kbd>
						</span>
						<span className="relative block">
							<Search
								aria-hidden="true"
								className="absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								id="reviewFilter"
								aria-keyshortcuts="/"
								ref={searchInput}
								autoComplete="off"
								className="pl-9 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
								name="reviewFilter"
								onChange={(event) => {
									const q = event.target.value;
									void navigate({
										replace: true,
										resetScroll: false,
										search: (previous) => ({ ...previous, q, page: 1 }),
									});
								}}
								placeholder="Ex.: minha-org/api ou 248"
								type="search"
								value={query}
							/>
						</span>
					</label>
					<label className="grid gap-2 text-sm font-semibold" htmlFor="reviewStatus">
						Status
						<Select
							onValueChange={(value) => {
								void navigate({
									resetScroll: false,
									search: (previous) => ({
										...previous,
										status: reviewsSearchSchema.shape.status.parse(value),
										page: 1,
									}),
								});
							}}
							value={statusFilter}
						>
							<SelectTrigger className="w-full" id="reviewStatus">
								<SelectValue>
									{statusFilter === "all" ? (
										"Todos os status"
									) : (
										<StatusBadge status={statusFilter} />
									)}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Todos os status</SelectItem>
								{reviewRunSummarySchema.shape.status.options.map((status) => (
									<SelectItem key={status} value={status}>
										<StatusBadge status={status} />
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</label>
				</div>
			</div>
			{data.length === 0 ? (
				<EmptyState
					description="Abra ou atualize um pull request elegível. A nova execução aparecerá aqui."
					title="Nenhuma review processada"
				/>
			) : (
				<div className="data-table-shell">
					<Table className="block sm:table [&_[data-column=pullRequestNumber]]:hidden sm:[&_[data-column=pullRequestNumber]]:table-cell [&_[data-column=findingCount]]:hidden lg:[&_[data-column=findingCount]]:table-cell [&_[data-column=cost]]:hidden lg:[&_[data-column=cost]]:table-cell [&_[data-column=createdAt]]:hidden xl:[&_[data-column=createdAt]]:table-cell [&_thead_[data-column=actions]]:hidden sm:[&_thead_[data-column=actions]]:table-cell">
						<caption className="sr-only">Histórico das reviews mais recentes</caption>
						<TableHeader className="block bg-muted/40 sm:table-header-group">
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow
									className="grid grid-cols-2 sm:table-row"
									key={headerGroup.id}
								>
									{headerGroup.headers.map((header) => (
										<TableHead
											aria-sort={
												header.column.getCanSort()
													? sortAriaValue(header.column.getIsSorted())
													: undefined
											}
											data-column={header.column.id}
											key={header.id}
											scope="col"
										>
											{header.isPlaceholder ? null : (
												<button
													className="control-motion inline-flex items-center gap-1.5 rounded-sm enabled:hover:text-primary enabled:active:text-primary/75 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-default"
													disabled={!header.column.getCanSort()}
													onClick={header.column.getToggleSortingHandler()}
													type="button"
												>
													<table.FlexRender header={header} />
													{header.column.getCanSort() ? (
														<SortIcon
															direction={header.column.getIsSorted()}
														/>
													) : null}
												</button>
											)}
										</TableHead>
									))}
								</TableRow>
							))}
						</TableHeader>
						<TableBody className="block sm:table-row-group">
							{filtered.length === 0 ? (
								<TableRow className="grid sm:table-row">
									<TableCell
										className="h-48 whitespace-normal px-5 py-6 text-center text-muted-foreground"
										colSpan={columns.length}
									>
										<p className="font-semibold text-foreground">
											Nenhuma review encontrada
										</p>
										<p className="mt-1 text-sm">
											Tente outro repositório, número de PR ou status.
										</p>
										<Button
											className="mt-3"
											onClick={() => {
												void navigate({
													resetScroll: false,
													search: (previous) => ({
														...previous,
														q: undefined,
														status: undefined,
														page: 1,
													}),
												});
											}}
											size="sm"
											variant="outline"
										>
											Limpar filtros
										</Button>
									</TableCell>
								</TableRow>
							) : (
								table.getRowModel().rows.map((row) => (
									<TableRow
										className="grid grid-cols-[minmax(0,1fr)_auto] sm:table-row"
										key={row.id}
									>
										{row.getAllCells().map((cell) => (
											<TableCell
												className="data-[column=repositoryFullName]:col-span-2"
												data-column={cell.column.id}
												key={cell.id}
											>
												<table.FlexRender cell={cell} />
											</TableCell>
										))}
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
					<div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-4">
						<p className="text-sm font-medium text-muted-foreground">
							Página {table.state.pagination.pageIndex + 1} de{" "}
							{Math.max(table.getPageCount(), 1)}
						</p>
						<div className="flex gap-2">
							<Button
								aria-label="Página anterior"
								disabled={!table.getCanPreviousPage()}
								onClick={() => table.previousPage()}
								size="icon-sm"
								variant="outline"
							>
								<ChevronLeft aria-hidden="true" />
							</Button>
							<Button
								aria-label="Próxima página"
								disabled={!table.getCanNextPage()}
								onClick={() => table.nextPage()}
								size="icon-sm"
								variant="outline"
							>
								<ChevronRight aria-hidden="true" />
							</Button>
						</div>
					</div>
				</div>
			)}
			<ReviewDetailDrawer onOpenChange={setDetailOpen} reviewRunId={search.reviewRunId} />
		</div>
	);
}

function ReviewsPending(): React.JSX.Element {
	return (
		<div className="page-container" aria-busy="true" aria-label="Carregando reviews">
			<PageHeader description={reviewsDescription} eyebrow="Operação" title="Reviews" />
			<div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4">
				{[0, 1].map((index) => (
					<div
						aria-hidden="true"
						className="surface-panel loading-panel flex h-40 flex-col justify-between p-4 sm:h-44 sm:p-5"
						key={index}
					>
						<div className="flex items-center justify-between gap-3">
							<Skeleton className="h-3 w-24 max-w-full" />
							<Skeleton className="loading-accent size-8 shrink-0" />
						</div>
						<Skeleton className="loading-accent h-8 w-16" />
						<Skeleton className="h-3 w-3/4" />
					</div>
				))}
			</div>
			<div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
				<div className="space-y-2">
					<h2 className="font-display text-2xl font-bold tracking-tight">
						Histórico de reviews
					</h2>
					<div className="loading-caption h-4">Carregando histórico…</div>
				</div>
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] lg:w-full lg:max-w-2xl">
					{[0, 1].map((index) => (
						<div
							aria-hidden="true"
							className="flex h-16 flex-col justify-between"
							key={index}
						>
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-11 w-full border-2 border-border" />
						</div>
					))}
				</div>
			</div>
			<output aria-label="Carregando histórico" className="data-table-shell block">
				<div className="flex items-center justify-between border-b border-border bg-accent/5 px-4 py-4">
					<Skeleton className="loading-accent h-4 w-28" />
					<Skeleton className="h-4 w-16" />
				</div>
				<div className="space-y-6 p-4">
					{Array.from({ length: 6 }, (_, index) => (
						<div
							className="grid grid-cols-[1fr_auto] gap-3 sm:grid-cols-[1fr_8rem_8rem]"
							key={index}
						>
							<div className="col-span-2 space-y-2 sm:col-span-1">
								<Skeleton className="h-4 w-2/3" />
								<Skeleton className="h-3 w-12 sm:hidden" />
							</div>
							<Skeleton className="h-7 w-24" />
							<Skeleton className="h-8 w-28" />
						</div>
					))}
				</div>
				<div className="flex justify-between bg-muted/20 p-4">
					<Skeleton className="h-5 w-32" />
					<Skeleton className="h-8 w-20" />
				</div>
			</output>
		</div>
	);
}

function sortAriaValue(direction: false | "asc" | "desc"): "none" | "ascending" | "descending" {
	if (!direction) return "none";
	return direction === "asc" ? "ascending" : "descending";
}

function SortIcon({
	direction,
}: {
	readonly direction: false | "asc" | "desc";
}): React.JSX.Element {
	if (direction === "asc") return <ArrowUp aria-hidden="true" className="size-3 text-primary" />;
	if (direction === "desc")
		return <ArrowDown aria-hidden="true" className="size-3 text-primary" />;
	return <ArrowUpDown aria-hidden="true" className="size-3 text-muted-foreground" />;
}
