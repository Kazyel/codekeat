import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const dashboardUsers = sqliteTable(
	"dashboard_users",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		passwordHash: text("password_hash").notNull(),
		role: text("role", { enum: ["admin", "member"] }).notNull(),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [uniqueIndex("dashboard_users_email_unique").on(table.email)],
);
