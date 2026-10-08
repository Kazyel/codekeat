import { BrandMark } from "@/components/brand-mark";

export function EmptyIllustration(): React.JSX.Element {
	return (
		<span
			aria-hidden="true"
			className="relative mb-6 block h-14 w-36 max-w-full shrink-0 text-foreground"
		>
			<svg
				aria-hidden="true"
				className="size-full"
				fill="none"
				focusable="false"
				viewBox="0 0 144 56"
			>
				<path d="M8 6h84v48H8z" fill="currentColor" fillOpacity="0.16" />
				<path
					className="fill-card"
					d="M4 2h84v48H4z"
					stroke="currentColor"
					strokeWidth="2"
				/>
				<path d="M4 22h84" stroke="currentColor" strokeOpacity="0.25" />
				<g stroke="currentColor" strokeLinecap="square" strokeWidth="2">
					<path d="m20 8-4 4 4 4m16-8 4 4-4 4M30 7l-4 10" />
					<path d="M30 32h42M30 42h30" strokeOpacity="0.45" />
					<path className="text-primary" d="M14 32h8" />
					<path className="text-accent" d="M14 42h8m-4-4v8" />
				</g>
			</svg>
			<BrandMark className="absolute right-0 top-1 size-12" />
		</span>
	);
}
