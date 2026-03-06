import { randomUUID } from "node:crypto";

import { DatabaseManager } from "../db/database-manager.js";
import { sqlQuery } from "../db/sql-safety.js";
import type {
  MemoryEntry,
  MemoryScope,
  MemorySearchOptions,
  ScopeRecordInput,
  ScopeRecordKey,
} from "./types.js";

interface MemoryRow {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly scope_id: string;
  readonly key: string;
  readonly value: string;
  readonly temperature: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly last_accessed_at: number;
  readonly access_count: number;
}

const toMemoryEntry = <T>(row: MemoryRow): MemoryEntry<T> => {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scope_id,
    key: row.key,
    value: JSON.parse(row.value) as T,
    temperature: row.temperature as MemoryEntry<T>["temperature"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
  };
};

const escapeFtsTerm = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '""';
  }

  return `"${trimmed.replaceAll('"', '""')}"`;
};

const normalizeLimit = (value: number | undefined): number => {
  const limit = value ?? 20;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("search limit must be a positive integer");
  }

  return limit;
};

export class SqliteMemoryStore {
  private hasFts = false;

  constructor(private readonly database: DatabaseManager) {}

  async initialize(): Promise<void> {
    await this.database.initialize();

    this.database.run(sqlQuery`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        temperature TEXT NOT NULL DEFAULT 'warm',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.database.run(sqlQuery`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_scope_key
      ON memory_entries(scope, scope_id, key)
    `);

    this.database.run(sqlQuery`
      CREATE INDEX IF NOT EXISTS idx_memory_scope
      ON memory_entries(scope, scope_id)
    `);

    try {
      this.database.run(sqlQuery`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
        USING fts5(key, value, content='memory_entries', content_rowid='rowid')
      `);

      this.database.exec(
        "CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory_entries BEGIN INSERT INTO memory_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value); END;",
      );

      this.database.exec(
        "CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory_entries BEGIN INSERT INTO memory_fts(memory_fts, rowid, key, value) VALUES ('delete', old.rowid, old.key, old.value); END;",
      );

      this.database.exec(
        "CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory_entries BEGIN INSERT INTO memory_fts(memory_fts, rowid, key, value) VALUES ('delete', old.rowid, old.key, old.value); INSERT INTO memory_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value); END;",
      );

      this.hasFts = true;
    } catch {
      this.hasFts = false;
    }
  }

  upsert<T>(
    input: ScopeRecordInput<T>,
    now: number = Date.now(),
  ): MemoryEntry<T> {
    const id = randomUUID();
    const serializedValue = JSON.stringify(input.value);

    this.database.run(sqlQuery`
      INSERT INTO memory_entries (
        id, scope, scope_id, key, value, temperature,
        created_at, updated_at, last_accessed_at, access_count
      )
      VALUES (
        ${id}, ${input.scope}, ${input.scopeId}, ${input.key}, ${serializedValue}, ${"warm"},
        ${now}, ${now}, ${now}, ${0}
      )
      ON CONFLICT(scope, scope_id, key)
      DO UPDATE SET
        value = excluded.value,
        temperature = excluded.temperature,
        updated_at = excluded.updated_at
    `);

    const row = this.database.get<MemoryRow>(sqlQuery`
      SELECT id, scope, scope_id, key, value, temperature,
             created_at, updated_at, last_accessed_at, access_count
      FROM memory_entries
      WHERE scope = ${input.scope} AND scope_id = ${input.scopeId} AND key = ${input.key}
    `);

    if (!row) {
      throw new Error("Failed to load memory entry after upsert");
    }

    return toMemoryEntry<T>(row);
  }

  get<T>(
    key: ScopeRecordKey,
    now: number = Date.now(),
  ): MemoryEntry<T> | undefined {
    const row = this.database.get<MemoryRow>(sqlQuery`
      SELECT id, scope, scope_id, key, value, temperature,
             created_at, updated_at, last_accessed_at, access_count
      FROM memory_entries
      WHERE scope = ${key.scope} AND scope_id = ${key.scopeId} AND key = ${key.key}
    `);

    if (!row) {
      return undefined;
    }

    this.database.run(sqlQuery`
      UPDATE memory_entries
      SET last_accessed_at = ${now}, access_count = access_count + 1
      WHERE id = ${row.id}
    `);

    const updated = this.database.get<MemoryRow>(sqlQuery`
      SELECT id, scope, scope_id, key, value, temperature,
             created_at, updated_at, last_accessed_at, access_count
      FROM memory_entries
      WHERE id = ${row.id}
    `);

    return updated ? toMemoryEntry<T>(updated) : undefined;
  }

  delete(key: ScopeRecordKey): boolean {
    const existing = this.database.get<Pick<MemoryRow, "id">>(sqlQuery`
      SELECT id
      FROM memory_entries
      WHERE scope = ${key.scope} AND scope_id = ${key.scopeId} AND key = ${key.key}
    `);

    if (!existing) {
      return false;
    }

    this.database.run(sqlQuery`
      DELETE FROM memory_entries
      WHERE id = ${existing.id}
    `);

    return true;
  }

  clearScope(scope: MemoryScope, scopeId: string): number {
    const countRow = this.database.get<{ readonly count: number }>(sqlQuery`
      SELECT COUNT(*) as count
      FROM memory_entries
      WHERE scope = ${scope} AND scope_id = ${scopeId}
    `);

    const count = countRow?.count ?? 0;
    if (count === 0) {
      return 0;
    }

    this.database.run(sqlQuery`
      DELETE FROM memory_entries
      WHERE scope = ${scope} AND scope_id = ${scopeId}
    `);

    return count;
  }

  list(scope?: MemoryScope, scopeId?: string): MemoryEntry[] {
    let rows: MemoryRow[];

    if (scope && scopeId) {
      rows = this.database.all<MemoryRow>(sqlQuery`
        SELECT id, scope, scope_id, key, value, temperature,
               created_at, updated_at, last_accessed_at, access_count
        FROM memory_entries
        WHERE scope = ${scope} AND scope_id = ${scopeId}
        ORDER BY updated_at DESC
      `);
    } else if (scope) {
      rows = this.database.all<MemoryRow>(sqlQuery`
        SELECT id, scope, scope_id, key, value, temperature,
               created_at, updated_at, last_accessed_at, access_count
        FROM memory_entries
        WHERE scope = ${scope}
        ORDER BY updated_at DESC
      `);
    } else {
      rows = this.database.all<MemoryRow>(sqlQuery`
        SELECT id, scope, scope_id, key, value, temperature,
               created_at, updated_at, last_accessed_at, access_count
        FROM memory_entries
        ORDER BY updated_at DESC
      `);
    }

    return rows.map((row) => toMemoryEntry(row));
  }

  search(term: string, options: MemorySearchOptions = {}): MemoryEntry[] {
    const limit = normalizeLimit(options.limit);
    const ftsTerm = escapeFtsTerm(term);
    const likeTerm = `%${term.toLowerCase()}%`;
    let rows: MemoryRow[];

    if (this.hasFts && options.scope && options.scopeId) {
      rows = this.database.all<MemoryRow>(sqlQuery`
        SELECT m.id, m.scope, m.scope_id, m.key, m.value, m.temperature,
               m.created_at, m.updated_at, m.last_accessed_at, m.access_count
        FROM memory_entries m
        JOIN memory_fts f ON f.rowid = m.rowid
        WHERE memory_fts MATCH ${ftsTerm}
          AND m.scope = ${options.scope}
          AND m.scope_id = ${options.scopeId}
        ORDER BY m.updated_at DESC
        LIMIT ${limit}
      `);
    } else if (this.hasFts && options.scope) {
      rows = this.database.all<MemoryRow>(sqlQuery`
        SELECT m.id, m.scope, m.scope_id, m.key, m.value, m.temperature,
               m.created_at, m.updated_at, m.last_accessed_at, m.access_count
        FROM memory_entries m
        JOIN memory_fts f ON f.rowid = m.rowid
        WHERE memory_fts MATCH ${ftsTerm}
          AND m.scope = ${options.scope}
        ORDER BY m.updated_at DESC
        LIMIT ${limit}
      `);
    } else if (this.hasFts) {
      rows = this.database.all<MemoryRow>(sqlQuery`
        SELECT m.id, m.scope, m.scope_id, m.key, m.value, m.temperature,
               m.created_at, m.updated_at, m.last_accessed_at, m.access_count
        FROM memory_entries m
        JOIN memory_fts f ON f.rowid = m.rowid
        WHERE memory_fts MATCH ${ftsTerm}
        ORDER BY m.updated_at DESC
        LIMIT ${limit}
      `);
    } else if (options.scope && options.scopeId) {
      rows = this.database.all<MemoryRow>(sqlQuery`
        SELECT id, scope, scope_id, key, value, temperature,
               created_at, updated_at, last_accessed_at, access_count
        FROM memory_entries
        WHERE (lower(key) LIKE ${likeTerm} OR lower(value) LIKE ${likeTerm})
          AND scope = ${options.scope}
          AND scope_id = ${options.scopeId}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `);
    } else if (options.scope) {
      rows = this.database.all<MemoryRow>(sqlQuery`
        SELECT id, scope, scope_id, key, value, temperature,
               created_at, updated_at, last_accessed_at, access_count
        FROM memory_entries
        WHERE (lower(key) LIKE ${likeTerm} OR lower(value) LIKE ${likeTerm})
          AND scope = ${options.scope}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `);
    } else {
      rows = this.database.all<MemoryRow>(sqlQuery`
        SELECT id, scope, scope_id, key, value, temperature,
               created_at, updated_at, last_accessed_at, access_count
        FROM memory_entries
        WHERE lower(key) LIKE ${likeTerm} OR lower(value) LIKE ${likeTerm}
        ORDER BY updated_at DESC
        LIMIT ${limit}
      `);
    }

    return rows.map((row) => toMemoryEntry(row));
  }

  clearAll(): void {
    this.database.run(sqlQuery`DELETE FROM memory_entries`);
  }
}
