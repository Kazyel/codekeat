import { Logo3D } from "./logo-3d";

export function SignalHero({
	children,
}: {
	readonly children: React.ReactNode;
}): React.JSX.Element {
	return (
		<section className="signal-hero">
			<div className="signal-hero-copy">{children}</div>
			<Logo3D />
		</section>
	);
}
