import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/memory/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "./.agent-p/agent-p.db",
  },
  strict: true,
  verbose: true,
});
