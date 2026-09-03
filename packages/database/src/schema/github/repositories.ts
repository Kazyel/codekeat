import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { installations } from "./installations.js";

export const repositories = sqliteTable(
	"repositories",
	{
		githubRepositoryId: integer("github_repository_id").primaryKey(),
		installationId: integer("installation_id")
			.notNull()
			.references(() => installations.githubInstallationId),
		ownerLogin: text("owner_login").notNull(),
		name: text("name").notNull(),
		defaultBranch: text("default_branch").notNull(),
		status: text("status", { enum: ["active", "removed"] }).notNull(),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [index("repositories_installation_id_index").on(table.installationId)],
);
