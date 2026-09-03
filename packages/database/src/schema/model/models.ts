import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const models = sqliteTable(
	"models",
	{
		id: text("id").primaryKey(),
		displayName: text("display_name").notNull(),
		apiName: text("api_name").notNull(),
		inputNanoUsdPerToken: integer("input_nano_usd_per_token").notNull(),
		cachedInputNanoUsdPerToken: integer("cached_input_nano_usd_per_token").notNull(),
		outputNanoUsdPerToken: integer("output_nano_usd_per_token").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull(),
		selected: integer("selected", { mode: "boolean" }).notNull(),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("models_api_name_unique").on(table.apiName),
		uniqueIndex("models_selected_unique")
			.on(table.selected)
			.where(sql`${table.selected} = 1`),
	],
);
