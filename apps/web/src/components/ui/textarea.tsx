import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"field-surface control-motion flex field-sizing-content min-h-24 w-full rounded-lg border-2 bg-card px-3.5 py-3 text-sm font-medium shadow-[3px_3px_0_var(--control-edge)] placeholder:font-normal placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
