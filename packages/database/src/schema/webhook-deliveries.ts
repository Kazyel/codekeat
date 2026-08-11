import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    eventName: text("event_name").notNull(),
    installationId: integer("installation_id"),
    status: text("status", { enum: ["processing", "handled", "failed", "ignored"] }).notNull(),
    attempts: integer("attempts").notNull(),
    reasonCode: text("reason_code"),
    failureCode: text("failure_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("webhook_deliveries_installation_id_index").on(table.installationId)],
);
