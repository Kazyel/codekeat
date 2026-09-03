export interface WebhookDeliveryInput {
	readonly deliveryId: string;
	readonly eventName: string;
	readonly installationId: number | null;
}

export type WebhookDelivery = WebhookDeliveryInput;

export type DeliveryOutcome =
	| { readonly kind: "handled" }
	| { readonly kind: "ignored"; readonly reasonCode: string };

export type DeliveryProcessResult = "processed" | "duplicate";
