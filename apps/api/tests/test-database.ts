import {
  createDatabaseConnection,
  type DatabaseConnection,
  migrateDatabase,
  WebhookStore,
} from "@codekeat/database";

export interface TestDatabase {
  readonly connection: DatabaseConnection;
  readonly store: WebhookStore;
  close(): void;
}

export function createTestDatabase(): TestDatabase {
  const connection = createDatabaseConnection(":memory:");
  migrateDatabase(connection);

  return {
    connection,
    store: new WebhookStore(connection),
    close(): void {
      connection.close();
    },
  };
}
