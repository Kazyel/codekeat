import "dotenv/config";

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/**/*.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "../../data/codekeat.db",
  },
  strict: true,
  verbose: true,
});
