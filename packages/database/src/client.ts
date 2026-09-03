import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema/index.js";

export interface DatabaseConnection {
	readonly client: BetterSqlite3.Database;
	readonly db: ReturnType<typeof drizzle<typeof schema>>;
	close(): void;
}

export function createDatabaseConnection(databasePath: string): DatabaseConnection {
	const client = new BetterSqlite3(databasePath);
	client.pragma("journal_mode = WAL");
	client.pragma("foreign_keys = ON");

	return {
		client,
		db: drizzle(client, { schema }),
		close(): void {
			client.close();
		},
	};
}
