import { BrandMark } from "@/components/brand-mark";

export function SignalHero({ children }: { readonly children: React.ReactNode }) {
	return (
		<section className="signal-hero">
			<div aria-hidden="true" className="signal-grid" />
			<BrandMark className="absolute right-8 top-1/2 hidden size-52 -translate-y-1/2 md:block lg:right-12 lg:size-60" />
			<div className="relative z-10 md:max-w-[64%]">{children}</div>
		</section>
	);
}
