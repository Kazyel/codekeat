import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { DatabaseConnection } from "./client.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export function migrateDatabase(connection: DatabaseConnection): void {
	migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
}
