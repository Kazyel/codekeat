import { Badge } from "@/components/ui/badge";
import type { ReviewRunStatus } from "@/lib/api-contracts";

const STATUS_LABEL: Readonly<Record<ReviewRunStatus, string>> = {
	queued: "Na fila",
	running: "Executando",
	completed: "Concluída",
	failed: "Falhou",
	ignored: "Ignorada",
};

export function StatusBadge({ status }: { readonly status: ReviewRunStatus }) {
	return (
		<Badge className={`status-badge status-${status}`} variant="outline">
			<span aria-hidden="true" className="status-dot" />
			{STATUS_LABEL[status]}
		</Badge>
	);
}
