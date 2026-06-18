import { defineConfig } from "drizzle-kit";

const isPg = !!process.env.DATABASE_URL?.startsWith("postgres");

export default defineConfig({
  schema: isPg ? "./lib/schema.pg.ts" : "./lib/schema.sqlite.ts",
  out: isPg ? "./drizzle-pg" : "./drizzle",
  dialect: isPg ? "postgresql" : "sqlite",
  dbCredentials: isPg
    ? { url: process.env.DATABASE_URL! }
    : { url: process.env.DATABASE_PATH || "./data/coomander.db" },
  // Exclude Better Auth tables — they manage their own schema.
  tablesFilter: ["!user", "!session", "!account", "!verification", "!twoFactor"],
});
