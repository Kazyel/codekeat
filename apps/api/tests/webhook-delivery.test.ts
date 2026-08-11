import { describe, expect, it } from "vitest";

import { processWebhookDelivery } from "../src/modules/github/webhook-delivery.js";
import { createTestDatabase } from "./test-database.js";

describe("processWebhookDelivery", () => {
  it("does not process a handled delivery twice", async () => {
    const database = createTestDatabase();
    let executions = 0;
    const delivery = {
      deliveryId: "delivery-1",
      eventName: "pull_request.opened",
      installationId: 1,
    };

    await processWebhookDelivery(database.store, delivery, async () => {
      executions += 1;
      return { kind: "handled" };
    });
    const duplicate = await processWebhookDelivery(database.store, delivery, async () => {
      executions += 1;
      return { kind: "handled" };
    });

    expect(executions).toBe(1);
    expect(duplicate).toBe("duplicate");
    database.close();
  });

  it("allows a failed delivery to be claimed again", async () => {
    const database = createTestDatabase();
    const delivery = {
      deliveryId: "delivery-2",
      eventName: "pull_request.opened",
      installationId: 1,
    };

    await expect(
      processWebhookDelivery(database.store, delivery, async () => {
        throw new Error("temporary failure");
      }),
    ).rejects.toThrow("temporary failure");

    const retry = await processWebhookDelivery(database.store, delivery, async () => ({
      kind: "handled",
    }));

    expect(retry).toBe("processed");
    database.close();
  });
});
