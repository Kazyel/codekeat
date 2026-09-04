const INTEGER_FORMAT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const COMPACT_FORMAT = new Intl.NumberFormat("pt-BR", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const USD_FORMAT = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 4,
});
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	timeZone: "UTC",
	timeZoneName: "short",
});
const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "short",
	timeZone: "UTC",
});

export function formatInteger(value: number): string {
	return INTEGER_FORMAT.format(value);
}

export function formatCompact(value: number): string {
	return COMPACT_FORMAT.format(value);
}

export function formatUsdMicros(value: number): string {
	return USD_FORMAT.format(value / 1_000_000);
}

export function formatTokenPricePerMillion(nanoUsdPerToken: number): string {
	return USD_FORMAT.format(nanoUsdPerToken / 1_000);
}

export function formatDateTime(value: string): string {
	return DATE_TIME_FORMAT.format(new Date(value));
}

export function formatPeriod(value: string): string {
	const date =
		value.length === 7 ? new Date(`${value}-01T00:00:00Z`) : new Date(`${value}T00:00:00Z`);
	return DATE_FORMAT.format(date);
}

export function formatDuration(value: number | null): string {
	if (value === null) return "Indisponível";
	if (value < 1_000) return `${value} ms`;
	return `${(value / 1_000).toFixed(1)} s`;
}
