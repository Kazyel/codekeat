import { cn } from "@/lib/utils";

interface BorderBeamProps {
	readonly className?: string;
}

export function BorderBeam({ className }: BorderBeamProps) {
	return <span aria-hidden="true" className={cn("border-beam", className)} />;
}
