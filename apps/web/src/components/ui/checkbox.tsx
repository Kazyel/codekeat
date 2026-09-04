import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer relative flex size-5 shrink-0 items-center justify-center rounded-[0.3rem] border-2 border-foreground bg-card shadow-[2px_2px_0_var(--hard-shadow)] transition-[border-color,background-color,box-shadow,transform] outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 hover:-translate-y-0.5 focus-visible:border-primary focus-visible:shadow-[3px_3px_0_#fc6701] focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-checked:bg-primary data-checked:text-primary-foreground data-checked:shadow-[2px_2px_0_var(--hard-shadow)] [&_svg]:pointer-events-none [&_svg]:size-3.5",
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
