import type { WebhookStore } from "@codekeat/database";

export interface WebhookDelivery {
  readonly deliveryId: string;
  readonly eventName: string;
  readonly installationId: number | null;
}

export type DeliveryOutcome =
  | { readonly kind: "handled" }
  | { readonly kind: "ignored"; readonly reasonCode: string };

export type DeliveryProcessResult = "processed" | "duplicate";

export async function processWebhookDelivery(
  store: WebhookStore,
  delivery: WebhookDelivery,
  action: () => Promise<DeliveryOutcome>,
): Promise<DeliveryProcessResult> {
  if (store.claimDelivery(delivery) === "duplicate") {
    return "duplicate";
  }

  try {
    const outcome = await action();
    markDeliveryOutcome(store, delivery.deliveryId, outcome);
    return "processed";
  } catch (error) {
    store.markDeliveryFailed(delivery.deliveryId, "webhook_handler_failed");
    throw error;
  }
}

function markDeliveryOutcome(
  store: WebhookStore,
  deliveryId: string,
  outcome: DeliveryOutcome,
): void {
  if (outcome.kind === "handled") {
    store.markDeliveryHandled(deliveryId);
    return;
  }

  store.markDeliveryIgnored(deliveryId, outcome.reasonCode);
}
