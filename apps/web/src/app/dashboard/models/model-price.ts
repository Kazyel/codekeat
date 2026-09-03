export function usdPerMillionToNanoUsdPerToken(value: string): number {
	return Math.round(Number(value) * 1_000);
}
