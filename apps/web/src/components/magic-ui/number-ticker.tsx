import { useEffect, useState } from "react";

interface NumberTickerProps {
	readonly value: number;
	readonly format?: (value: number) => string;
}

const DEFAULT_DURATION_MS = 650;

export function NumberTicker({ value, format = String }: NumberTickerProps) {
	const [displayValue, setDisplayValue] = useState(0);

	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			const frameId = requestAnimationFrame(() => setDisplayValue(value));
			return () => cancelAnimationFrame(frameId);
		}

		const startedAt = performance.now();
		let frameId = 0;
		const tick = (now: number) => {
			const progress = Math.min((now - startedAt) / DEFAULT_DURATION_MS, 1);
			setDisplayValue(Math.round(value * (1 - Math.pow(1 - progress, 3))));
			if (progress < 1) frameId = requestAnimationFrame(tick);
		};

		frameId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frameId);
	}, [value]);

	return <>{format(displayValue)}</>;
}
