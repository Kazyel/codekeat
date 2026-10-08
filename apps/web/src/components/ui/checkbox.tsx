import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer field-surface control-motion relative flex size-5 shrink-0 items-center justify-center rounded-[0.3rem] border-2 bg-card shadow-[2px_2px_0_var(--control-edge)] group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:bg-primary data-checked:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:size-3.5",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
			>
				<CheckIcon />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
