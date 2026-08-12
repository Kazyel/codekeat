import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { dashboardUsers } from "./dashboard-users.js";

export const dashboardSessions = sqliteTable(
  "dashboard_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => dashboardUsers.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("dashboard_sessions_token_hash_unique").on(table.tokenHash),
    index("dashboard_sessions_user_id_index").on(table.userId),
    index("dashboard_sessions_expires_at_index").on(table.expiresAt),
  ],
);
