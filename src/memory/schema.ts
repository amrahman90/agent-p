import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const memoryEntries = sqliteTable(
  "memory_entries",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    scopeId: text("scope_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    temperature: text("temperature").notNull().default("warm"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastAccessedAt: integer("last_accessed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    accessCount: integer("access_count").notNull().default(0),
  },
  (table) => {
    return {
      scopeIdx: index("idx_memory_scope").on(table.scope, table.scopeId),
      scopeKeyUnique: uniqueIndex("uq_memory_scope_key").on(
        table.scope,
        table.scopeId,
        table.key,
      ),
    };
  },
);
