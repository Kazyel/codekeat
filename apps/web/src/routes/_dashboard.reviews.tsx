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
import { ArrowUpDown, ChevronLeft, ChevronRight, PanelRightOpen, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { ReviewDetailDrawer } from "@/features/reviews/review-detail-drawer";
import { EmptyState } from "@/components/content-states";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { ReviewRunSummary } from "@/lib/api-contracts";
import { formatDateTime, formatUsdMicros } from "@/lib/format";
import { reviewRunsQuery } from "@/lib/queries";
const reviewsSearchSchema = z.object({ reviewRunId: z.uuid().optional() });

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
		cell: ({ row }) => <span className="font-medium">{row.original.repositoryFullName}</span>,
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
		cell: ({ row }) => <span className="tabular-nums">{row.original.findingCount}</span>,
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
		header: "Ações",
		cell: ({ row }) => (
			<Button
				render={<Link search={{ reviewRunId: row.original.id }} to="/reviews" />}
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
	validateSearch: (search) => reviewsSearchSchema.catch({}).parse(search),
	loader: ({ context }) => context.queryClient.query(reviewRunsQuery),
	component: ReviewsPage,
});

function ReviewsPage() {
	const { data } = useSuspenseQuery(reviewRunsQuery);
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [query, setQuery] = useState("");
	const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (normalized.length === 0) return data;
		return data.filter((run) =>
			`${run.repositoryFullName} ${run.pullRequestNumber} ${run.status}`
				.toLowerCase()
				.includes(normalized),
		);
	}, [data, query]);
	const table = useTable(
		{ features, columns, data: filtered, onSortingChange: setSorting, state: { sorting } },
		(state) => ({ pagination: state.pagination, sorting: state.sorting }),
	);
	const setDetailOpen = (open: boolean) => {
		if (open) return;
		void navigate({ replace: true, search: {} });
	};

	return (
		<div className="page-container">
			<PageHeader
				description="A API retorna os 50 runs mais recentes. Filtros e ordenação operam sobre esse conjunto."
				eyebrow="Operação"
				title="Reviews"
			/>
			<div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<label className="relative block w-full max-w-sm" htmlFor="reviewFilter">
					<span className="sr-only">Filtrar reviews</span>
					<Search
						aria-hidden="true"
						className="absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						id="reviewFilter"
						autoComplete="off"
						className="pl-9"
						name="reviewFilter"
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Ex.: repositório, PR ou status…"
						value={query}
					/>
				</label>
				<p className="text-sm font-medium text-muted-foreground">
					{filtered.length} de {data.length} runs
				</p>
			</div>
			{data.length === 0 ? (
				<EmptyState
					description="Abra ou atualize um pull request elegível. A nova execução aparecerá aqui."
					title="Nenhuma review processada"
				/>
			) : (
				<div className="data-table-shell">
					<Table>
						<TableHeader>
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow key={headerGroup.id}>
									{headerGroup.headers.map((header) => (
										<TableHead key={header.id}>
											{header.isPlaceholder ? null : (
												<button
													className="inline-flex items-center gap-1.5 disabled:cursor-default"
													disabled={!header.column.getCanSort()}
													onClick={header.column.getToggleSortingHandler()}
													type="button"
												>
													<table.FlexRender header={header} />
													{header.column.getCanSort() ? (
														<ArrowUpDown
															aria-hidden="true"
															className="size-3"
														/>
													) : null}
												</button>
											)}
										</TableHead>
									))}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{table.getRowModel().rows.length === 0 ? (
								<TableRow>
									<TableCell
										className="h-36 text-center text-muted-foreground"
										colSpan={columns.length}
									>
										Nenhum run corresponde ao filtro.
									</TableCell>
								</TableRow>
							) : (
								table.getRowModel().rows.map((row) => (
									<TableRow key={row.id}>
										{row.getAllCells().map((cell) => (
											<TableCell key={cell.id}>
												<table.FlexRender cell={cell} />
											</TableCell>
										))}
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
					<div className="flex items-center justify-between border-t border-border px-4 py-3">
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
