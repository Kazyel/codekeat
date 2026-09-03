import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository.js";
import type {
	DeliveryOutcome,
	DeliveryProcessResult,
	WebhookDelivery,
} from "../types/webhook-delivery.types.js";

export async function processWebhookDelivery(
	repository: WebhookDeliveryRepository,
	delivery: WebhookDelivery,
	action: () => Promise<DeliveryOutcome>,
): Promise<DeliveryProcessResult> {
	if (repository.claimDelivery(delivery) === "duplicate") {
		return "duplicate";
	}

	try {
		const outcome = await action();
		markDeliveryOutcome(repository, delivery.deliveryId, outcome);
		return "processed";
	} catch (error) {
		repository.markDeliveryFailed(delivery.deliveryId, "webhook_handler_failed");
		throw error;
	}
}

function markDeliveryOutcome(
	repository: WebhookDeliveryRepository,
	deliveryId: string,
	outcome: DeliveryOutcome,
): void {
	if (outcome.kind === "handled") {
		repository.markDeliveryHandled(deliveryId);
		return;
	}

	repository.markDeliveryIgnored(deliveryId, outcome.reasonCode);
}
