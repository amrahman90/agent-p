import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseManager } from "../../src/db/database-manager.js";
import { SqliteMemoryStore } from "../../src/memory/store.js";

describe("SqliteMemoryStore", () => {
  let dbPath = "";
  let database: DatabaseManager;
  let store: SqliteMemoryStore;

  beforeEach(async () => {
    dbPath = join(tmpdir(), `agent-p-memory-${randomUUID()}.db`);
    database = new DatabaseManager(dbPath);
    store = new SqliteMemoryStore(database);
    await store.initialize();
  });

  afterEach(() => {
    database.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  });

  it("upserts and loads entries from SQLite warm tier", () => {
    const upserted = store.upsert(
      {
        scope: "session",
        scopeId: "run-1",
        key: "task",
        value: { step: "implement store" },
      },
      100,
    );

    expect(upserted.temperature).toBe("warm");
    expect(upserted.createdAt).toBe(100);

    const loaded = store.get<{ step: string }>(
      { scope: "session", scopeId: "run-1", key: "task" },
      250,
    );

    expect(loaded?.value.step).toBe("implement store");
    expect(loaded?.accessCount).toBe(1);
    expect(loaded?.lastAccessedAt).toBe(250);
  });

  it("supports FTS search and keeps table safe against injection-like terms", () => {
    store.upsert({
      scope: "user",
      scopeId: "user-1",
      key: "auth-note",
      value: "authentication token refresh",
    });
    store.upsert({
      scope: "shared",
      scopeId: "app-1",
      key: "ops-note",
      value: "deployment checklist",
    });

    const scopedResults = store.search("authentication", {
      scope: "user",
      scopeId: "user-1",
      limit: 5,
    });
    expect(scopedResults).toHaveLength(1);
    expect(scopedResults[0]?.key).toBe("auth-note");

    const maliciousTerm = `"; DROP TABLE memory_entries; --`;
    expect(() => store.search(maliciousTerm, { limit: 5 })).not.toThrow();

    store.upsert({
      scope: "session",
      scopeId: "run-2",
      key: "still-there",
      value: "table intact",
    });
    expect(store.list()).toHaveLength(3);
  });

  it("validates search limit and supports delete/clear operations", () => {
    store.upsert({
      scope: "private",
      scopeId: "app-1:builder",
      key: "one",
      value: "a",
    });
    store.upsert({
      scope: "private",
      scopeId: "app-1:builder",
      key: "two",
      value: "b",
    });

    expect(() => store.search("a", { limit: 0 })).toThrow(
      "search limit must be a positive integer",
    );

    expect(
      store.delete({ scope: "private", scopeId: "app-1:builder", key: "one" }),
    ).toBe(true);
    expect(
      store.delete({
        scope: "private",
        scopeId: "app-1:builder",
        key: "missing",
      }),
    ).toBe(false);

    const cleared = store.clearScope("private", "app-1:builder");
    expect(cleared).toBe(1);
    expect(store.list("private", "app-1:builder")).toHaveLength(0);
  });
});
