import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { mountLogoScene } from "./logo-scene";

export function Logo3D(): React.JSX.Element {
	const hostRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [renderer, setRenderer] = useState<"loading" | "webgl" | "svg">("loading");

	useEffect(() => {
		const host = hostRef.current;
		const canvas = canvasRef.current;
		if (host === null || canvas === null) return;

		let dispose: (() => void) | null = null;
		const controller = new AbortController();
		const load = async (): Promise<void> => {
			try {
				const response = await fetch("/codekeat.svg", { signal: controller.signal });
				if (!response.ok) throw new Error("Unable to load the logo SVG.");
				const svg = await response.text();
				if (controller.signal.aborted) return;
				dispose = mountLogoScene(canvas, host, svg, () => setRenderer("svg"));
				setRenderer(dispose === null ? "svg" : "webgl");
			} catch {
				// Keep the original mark when its optional 3D representation is unavailable.
				if (!controller.signal.aborted) setRenderer("svg");
			}
		};
		const observer = new IntersectionObserver(([entry]) => {
			if (!entry?.isIntersecting) return;
			observer.disconnect();
			void load();
		});
		observer.observe(host);

		return () => {
			observer.disconnect();
			controller.abort();
			dispose?.();
		};
	}, []);

	return (
		<div aria-hidden="true" className="signal-art" data-renderer={renderer} ref={hostRef}>
			{renderer === "svg" ? <BrandMark className="h-[88%] w-auto max-w-[88%]" /> : null}
			<canvas className="signal-model" ref={canvasRef} />
		</div>
	);
}
