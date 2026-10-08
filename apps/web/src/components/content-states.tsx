import { AlertCircle, RotateCcw } from "lucide-react";

import { EmptyIllustration } from "@/components/empty-illustration";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function PanelSkeleton({ rows = 3 }: { readonly rows?: number }) {
	return (
		<output
			aria-label="Carregando conteúdo"
			className="surface-panel loading-panel block space-y-4 p-5"
		>
			<div className="loading-caption h-4">Carregando conteúdo…</div>
			{Array.from({ length: rows }, (_, index) => (
				<div aria-hidden="true" className="flex h-12 items-center gap-3" key={index}>
					<Skeleton className="loading-accent size-9 shrink-0" />
					<div className="min-w-0 flex-1 space-y-2">
						<Skeleton className="h-3 w-2/3" />
						<Skeleton className="h-2 w-1/3" />
					</div>
					<Skeleton className="h-5 w-14" />
				</div>
			))}
		</output>
	);
}

interface EmptyStateProps {
	readonly title: string;
	readonly description: string;
	readonly action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
	return (
		<div className="empty-state">
			<EmptyIllustration />
			<h2>{title}</h2>
			<p>{description}</p>
			{action}
		</div>
	);
}

interface ErrorStateProps {
	readonly title?: string;
	readonly description: string;
	readonly onRetry?: () => void;
}

export function ErrorState({
	title = "Não foi possível carregar",
	description,
	onRetry,
}: ErrorStateProps) {
	return (
		<div className="error-state" role="alert">
			<AlertCircle aria-hidden="true" />
			<div>
				<h2>{title}</h2>
				<p>{description}</p>
				{onRetry ? (
					<Button onClick={onRetry} size="sm" variant="outline">
						<RotateCcw aria-hidden="true" /> Tentar novamente
					</Button>
				) : null}
			</div>
		</div>
	);
}
