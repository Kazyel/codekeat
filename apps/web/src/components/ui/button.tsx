import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"group/button button-surface control-motion inline-flex shrink-0 items-center justify-center rounded-lg border-2 bg-clip-padding text-sm font-semibold whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:duration-75 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"button-edge-primary bg-primary text-primary-foreground shadow-[3px_3px_0_var(--control-edge)] hover:bg-[#d10014] hover:shadow-[4px_4px_0_var(--control-edge)] active:bg-primary active:shadow-[1px_1px_0_var(--control-edge)]",
				outline:
					"button-edge-neutral bg-card text-foreground shadow-[3px_3px_0_var(--control-edge)] hover:bg-accent hover:text-accent-foreground hover:shadow-[4px_4px_0_var(--control-edge)] active:shadow-[1px_1px_0_var(--control-edge)]",
				secondary:
					"button-edge-secondary bg-foreground text-background shadow-[3px_3px_0_var(--control-edge)] hover:shadow-[4px_4px_0_var(--control-edge)] active:shadow-[1px_1px_0_var(--control-edge)]",
				ghost: "button-edge-ghost text-foreground hover:bg-accent hover:text-accent-foreground hover:shadow-[2px_2px_0_var(--control-edge)] active:bg-accent active:text-accent-foreground active:shadow-none aria-expanded:bg-card aria-expanded:text-primary aria-expanded:shadow-[2px_2px_0_var(--control-edge)]",
				destructive:
					"button-edge-rose bg-destructive text-white shadow-[3px_3px_0_var(--control-edge)] hover:shadow-[4px_4px_0_var(--control-edge)] active:shadow-[1px_1px_0_var(--control-edge)]",
				link: "button-edge-none rounded-none text-primary decoration-transparent underline underline-offset-4 hover:decoration-current active:text-primary/75",
			},
			size: {
				default:
					"h-11 gap-2 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
				xs: "h-7 gap-1 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
				sm: "h-9 gap-1.5 rounded-md px-3 text-sm [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-12 gap-2 px-5 text-base",
				icon: "size-11",
				"icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-9 rounded-md",
				"icon-lg": "size-12",
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
