import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"field-surface control-motion h-11 w-full min-w-0 rounded-lg border-2 bg-card px-3.5 py-2 text-base font-normal shadow-[3px_3px_0_var(--control-edge)] md:text-sm file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground placeholder:font-normal placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
