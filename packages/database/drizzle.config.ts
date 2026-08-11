import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

const apiEnvironmentPath = fileURLToPath(new URL("../../apps/api/.env", import.meta.url));
const defaultDatabasePath = fileURLToPath(new URL("../../data/codekeat.db", import.meta.url));
const apiEnvironment = config({ path: apiEnvironmentPath });
const databasePath =
  process.env.DATABASE_PATH || apiEnvironment.parsed?.DATABASE_PATH || defaultDatabasePath;

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/**/*.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databasePath,
  },
  strict: true,
  verbose: true,
});
