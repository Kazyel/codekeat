"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
	CircleCheckIcon,
	InfoIcon,
	TriangleAlertIcon,
	OctagonXIcon,
	Loader2Icon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

const Toaster = ({ ...props }: ToasterProps): React.JSX.Element => {
	return (
		<Sonner
			className="app-toaster"
			closeButton
			containerAriaLabel="Notificações"
			icons={{
				success: <CircleCheckIcon aria-hidden="true" className="size-5" />,
				info: <InfoIcon aria-hidden="true" className="size-5" />,
				warning: <TriangleAlertIcon aria-hidden="true" className="size-5" />,
				error: <OctagonXIcon aria-hidden="true" className="size-5" />,
				loading: <Loader2Icon aria-hidden="true" className="size-5 animate-spin" />,
			}}
			toastOptions={{
				unstyled: true,
				closeButtonAriaLabel: "Fechar notificação",
				classNames: {
					toast: "app-toast",
					actionButton: buttonVariants({ size: "sm" }),
					cancelButton: buttonVariants({ variant: "outline", size: "sm" }),
					closeButton: buttonVariants({
						variant: "ghost",
						size: "icon-sm",
						className: "app-toast-close",
					}),
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
