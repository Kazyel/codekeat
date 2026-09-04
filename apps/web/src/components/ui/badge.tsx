import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"group/badge badge-surface inline-flex min-h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border-2 px-2.5 py-1 text-xs font-bold whitespace-nowrap transition-[background-color,color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring/40 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
	{
		variants: {
			variant: {
				default:
					"badge-edge-primary bg-primary text-primary-foreground [a]:hover:-translate-y-0.5 [a]:hover:bg-primary/85",
				secondary:
					"badge-edge-orange bg-accent text-accent-foreground [a]:hover:-translate-y-0.5 [a]:hover:bg-accent/85",
				destructive:
					"badge-edge-rose bg-destructive text-white focus-visible:ring-destructive/30 [a]:hover:-translate-y-0.5 [a]:hover:bg-destructive/85",
				outline:
					"badge-edge-orange bg-accent text-accent-foreground [a]:hover:-translate-y-0.5 [a]:hover:bg-accent/85",
				ghost: "badge-edge-none bg-transparent hover:bg-muted",
				link: "badge-edge-none bg-transparent text-primary underline-offset-4 hover:underline",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant = "default",
	render,
	...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{
				className: cn(badgeVariants({ variant }), className),
			},
			props,
		),
		render,
		state: {
			slot: "badge",
			variant,
		},
	});
}

export { Badge, badgeVariants };
