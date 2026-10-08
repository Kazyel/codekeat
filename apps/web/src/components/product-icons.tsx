import type { ComponentProps } from "react";

type IconProps = ComponentProps<"svg">;

function ProductIcon(props: IconProps): React.JSX.Element {
	return (
		<svg
			aria-hidden="true"
			data-product-icon=""
			fill="none"
			height={24}
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			viewBox="0 0 24 24"
			width={24}
			{...props}
		/>
	);
}

export function OverviewIcon(props: IconProps): React.JSX.Element {
	return (
		<ProductIcon {...props}>
			<path
				data-icon-tone=""
				d="M3 3h11v8H3zM10 15h11v6H10z"
				fill="currentColor"
				fillOpacity="var(--icon-fill-opacity, 0.18)"
			/>
			<path d="M18 3h3v8h-3M3 15h3v6H3M6 7h5M14 18h3" />
		</ProductIcon>
	);
}

export function ReviewIcon(props: IconProps): React.JSX.Element {
	return (
		<ProductIcon {...props}>
			<path d="M5 7v10M5 12h4a4 4 0 0 0 4-4" />
			<circle cx={5} cy={5} r={2} fill="currentColor" />
			<circle cx={5} cy={19} r={2} fill="currentColor" />
			<path
				data-icon-tone=""
				d="M11 3h10v9h-4l-4 3v-3h-2z"
				fill="currentColor"
				fillOpacity="var(--icon-fill-opacity, 0.18)"
			/>
			<path d="M15 7h3M13 19h8" />
		</ProductIcon>
	);
}

export function AnalyticsIcon(props: IconProps): React.JSX.Element {
	return (
		<ProductIcon {...props}>
			<path
				data-icon-tone=""
				d="M4 14h4v7H4zM16 9h4v12h-4z"
				fill="currentColor"
				fillOpacity="var(--icon-fill-opacity, 0.18)"
			/>
			<path d="M3 8h4l3-5 4 9 3-7h4M12 16v5" />
		</ProductIcon>
	);
}

export function ConnectionsIcon(props: IconProps): React.JSX.Element {
	return (
		<ProductIcon {...props}>
			<path
				data-icon-tone=""
				d="M9 15H7a4 4 0 0 1 0-8h4a4 4 0 0 1 4 4M15 9h2a4 4 0 0 1 0 8h-4a4 4 0 0 1-4-4"
				fill="currentColor"
				fillOpacity="var(--icon-fill-opacity, 0.18)"
			/>
			<path d="M9 12h6M7 7V4M17 17v3" />
			<circle cx={7} cy={3} r={1} fill="currentColor" />
			<circle cx={17} cy={21} r={1} fill="currentColor" />
		</ProductIcon>
	);
}

export function ModelsIcon(props: IconProps): React.JSX.Element {
	return (
		<ProductIcon {...props}>
			<path
				data-icon-tone=""
				d="M4 3h6v6H4zM14 15h6v6h-6z"
				fill="currentColor"
				fillOpacity="var(--icon-fill-opacity, 0.18)"
			/>
			<path d="M14 3h6v6h-6zM4 15h6v6H4zM7 9v6M17 9v6M10 6h4M10 18h4" />
		</ProductIcon>
	);
}

export function FindingsIcon(props: IconProps): React.JSX.Element {
	return (
		<ProductIcon {...props}>
			<path
				data-icon-tone=""
				d="M4 3h12l4 4v14H4z"
				fill="currentColor"
				fillOpacity="var(--icon-fill-opacity, 0.18)"
			/>
			<path d="M15 3v5h5M8 9h3M8 15h4M10 13v4" />
			<path d="M16 12v3" />
			<circle cx={16} cy={18} r={1} fill="currentColor" stroke="none" />
		</ProductIcon>
	);
}

export function CostIcon(props: IconProps): React.JSX.Element {
	return (
		<ProductIcon {...props}>
			<path
				data-icon-tone=""
				d="M5 3h14v18l-3-2-4 2-4-2-3 2z"
				fill="currentColor"
				fillOpacity="var(--icon-fill-opacity, 0.18)"
			/>
			<path d="M9 7h6M9 11h1M14 11h1M9 15h1M14 15h1" />
		</ProductIcon>
	);
}

export function ExecutionIcon(props: IconProps): React.JSX.Element {
	return (
		<ProductIcon {...props}>
			<path d="M9 6h6M18 9v6" />
			<path
				data-icon-tone=""
				d="M3 3h6v6H3zM15 3h6v6h-6z"
				fill="currentColor"
				fillOpacity="var(--icon-fill-opacity, 0.18)"
			/>
			<circle cx={18} cy={18} r={3} fill="currentColor" />
		</ProductIcon>
	);
}
