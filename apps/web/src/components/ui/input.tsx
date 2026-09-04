import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"h-11 w-full min-w-0 rounded-lg border-2 border-foreground bg-card px-3.5 py-2 text-sm font-medium shadow-[3px_3px_0_var(--hard-shadow)] transition-[border-color,box-shadow,transform,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground placeholder:font-normal placeholder:text-muted-foreground/80 hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:border-primary focus-visible:shadow-[4px_4px_0_#fc6701] focus-visible:ring-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:shadow-[3px_3px_0_var(--destructive)]",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
