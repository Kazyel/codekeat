import { type DatabaseConnection, webhookDeliveries } from "@codekeat/database";
import { eq, sql } from "drizzle-orm";
import { currentTimestamp } from "#shared/database";

import type { WebhookDeliveryInput } from "../types/webhook-delivery.types.js";

type DeliveryStatus = "processing" | "handled" | "failed" | "ignored";

export class WebhookDeliveryRepository {
	constructor(private readonly connection: DatabaseConnection) {}

	claimDelivery(input: WebhookDeliveryInput): "claimed" | "duplicate" {
		const current = this.connection.db
			.select({ status: webhookDeliveries.status })
			.from(webhookDeliveries)
			.where(eq(webhookDeliveries.deliveryId, input.deliveryId))
			.get();

		if (current === undefined) {
			this.insertDelivery(input);
			return "claimed";
		}

		if (current.status !== "failed") {
			return "duplicate";
		}

		this.retryDelivery(input.deliveryId);
		return "claimed";
	}

	markDeliveryHandled(deliveryId: string): void {
		this.setDeliveryStatus(deliveryId, "handled", null, null);
	}

	markDeliveryIgnored(deliveryId: string, reasonCode: string): void {
		this.setDeliveryStatus(deliveryId, "ignored", reasonCode, null);
	}

	markDeliveryFailed(deliveryId: string, failureCode: string): void {
		this.setDeliveryStatus(deliveryId, "failed", null, failureCode);
	}

	private insertDelivery(input: WebhookDeliveryInput): void {
		const now = currentTimestamp();
		this.connection.db
			.insert(webhookDeliveries)
			.values({
				...input,
				status: "processing",
				attempts: 1,
				reasonCode: null,
				failureCode: null,
				createdAt: now,
				updatedAt: now,
			})
			.run();
	}

	private retryDelivery(deliveryId: string): void {
		this.connection.db
			.update(webhookDeliveries)
			.set({
				status: "processing",
				attempts: sql`${webhookDeliveries.attempts} + 1`,
				failureCode: null,
				updatedAt: currentTimestamp(),
			})
			.where(eq(webhookDeliveries.deliveryId, deliveryId))
			.run();
	}

	private setDeliveryStatus(
		deliveryId: string,
		status: DeliveryStatus,
		reasonCode: string | null,
		failureCode: string | null,
	): void {
		this.connection.db
			.update(webhookDeliveries)
			.set({ status, reasonCode, failureCode, updatedAt: currentTimestamp() })
			.where(eq(webhookDeliveries.deliveryId, deliveryId))
			.run();
	}
}
