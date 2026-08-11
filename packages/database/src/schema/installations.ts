import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const installations = sqliteTable("installations", {
  githubInstallationId: integer("github_installation_id").primaryKey(),
  organizationLogin: text("organization_login").notNull(),
  status: text("status", { enum: ["active", "suspended", "deleted"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
