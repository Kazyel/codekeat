import { AlertCircle, Inbox, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function PanelSkeleton({ rows = 3 }: { readonly rows?: number }) {
	return (
		<output aria-label="Carregando conteúdo" className="surface-panel block space-y-4 p-5">
			<Skeleton className="h-4 w-32" />
			{Array.from({ length: rows }, (_, index) => (
				<Skeleton className="h-12 w-full" key={index} />
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
			<span className="empty-orb">
				<Inbox aria-hidden="true" />
			</span>
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
