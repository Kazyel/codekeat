import { cn } from "@/lib/utils";

interface BrandMarkProps {
	readonly className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
	return (
		<img
			alt=""
			aria-hidden="true"
			className={cn("brand-mark", className)}
			height={32}
			src="/codekeat.svg"
			width={32}
		/>
	);
}
