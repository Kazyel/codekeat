import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"flex field-sizing-content min-h-24 w-full rounded-lg border-2 border-foreground bg-card px-3.5 py-3 text-sm font-medium shadow-[3px_3px_0_var(--hard-shadow)] transition-[border-color,box-shadow,transform,background-color] outline-none placeholder:font-normal placeholder:text-muted-foreground/80 hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:border-primary focus-visible:shadow-[4px_4px_0_#fc6701] focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:shadow-[3px_3px_0_var(--destructive)]",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
