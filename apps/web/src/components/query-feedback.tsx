import { CircleAlert, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface QueryFeedbackProps {
	readonly isFetching: boolean;
	readonly isRefetchError: boolean;
	readonly onRefresh: () => void;
}

export function QueryFeedback({
	isFetching,
	isRefetchError,
	onRefresh,
}: QueryFeedbackProps): React.JSX.Element {
	const Icon = isRefetchError && !isFetching ? CircleAlert : RefreshCw;
	const message = refreshMessage(isFetching, isRefetchError);

	return (
		<span className="inline-flex shrink-0 items-center align-middle">
			<output className="sr-only">{message}</output>
			<Button
				aria-label="Atualizar dados"
				aria-busy={isFetching}
				disabled={isFetching}
				onClick={onRefresh}
				size="icon-sm"
				title={message ?? "Atualizar dados"}
				variant="ghost"
			>
				<Icon
					aria-hidden="true"
					className={isFetching ? "motion-safe:animate-spin" : undefined}
				/>
			</Button>
		</span>
	);
}

function refreshMessage(isFetching: boolean, isRefetchError: boolean): string | null {
	if (isFetching) return "Atualizando…";
	if (isRefetchError) return "Falha ao atualizar. Dados anteriores mantidos.";
	return null;
}
