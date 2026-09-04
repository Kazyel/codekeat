import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"group/button button-surface inline-flex shrink-0 items-center justify-center rounded-lg border-2 bg-clip-padding text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,transform] outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/35 active:not-aria-[haspopup]:translate-x-0.5 active:not-aria-[haspopup]:translate-y-0.5 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"button-edge-primary bg-primary text-primary-foreground shadow-[3px_3px_0_var(--button-shadow)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-[5px_5px_0_var(--button-shadow)] active:shadow-none",
				outline:
					"button-edge-neutral bg-card text-foreground shadow-[3px_3px_0_var(--button-shadow)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-accent hover:shadow-[5px_5px_0_var(--button-shadow)] active:shadow-none",
				secondary:
					"button-edge-secondary bg-foreground text-background shadow-[3px_3px_0_var(--button-shadow)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-foreground/90 hover:shadow-[5px_5px_0_var(--button-shadow)] active:shadow-none",
				ghost: "button-edge-ghost text-foreground hover:bg-card hover:text-primary hover:shadow-[3px_3px_0_var(--button-shadow)] aria-expanded:bg-card aria-expanded:text-primary aria-expanded:shadow-[3px_3px_0_var(--button-shadow)]",
				destructive:
					"button-edge-rose bg-destructive text-white shadow-[3px_3px_0_var(--button-shadow)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-destructive/90 hover:shadow-[5px_5px_0_var(--button-shadow)] active:shadow-none",
				link: "button-edge-none rounded-none text-primary underline-offset-4 hover:underline",
			},
			size: {
				default:
					"h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
				xs: "h-7 gap-1 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
				sm: "h-9 gap-1.5 rounded-md px-3 text-sm [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-11 gap-2 px-5 text-base",
				icon: "size-10",
				"icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-9 rounded-md",
				"icon-lg": "size-11",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return (
		<ButtonPrimitive
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
