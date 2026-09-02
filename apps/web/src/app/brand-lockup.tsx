import Image from "next/image";
import type { ReactNode } from "react";

export function BrandLockup(): ReactNode {
	return (
		<span className="brand-lockup">
			<Image alt="" aria-hidden="true" height={44} src="/codekeat.svg" width={44} />
			<span className="brand-lockup-copy">
				<strong>Codekeat</strong>
				<small>revisão consultiva</small>
			</span>
		</span>
	);
}
