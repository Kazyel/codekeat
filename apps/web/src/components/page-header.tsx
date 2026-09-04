interface PageHeaderProps {
	readonly eyebrow: string;
	readonly title: string;
	readonly description: string;
	readonly action?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
	return (
		<header className="page-header">
			<div>
				<p className="eyebrow">{eyebrow}</p>
				<h1>{title}</h1>
				<p className="page-description">{description}</p>
			</div>
			{action}
		</header>
	);
}
