import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { DatabaseManager } from "../../src/db/database-manager.js";
import { runMigrations } from "../../src/db/migration-runner.js";

describe("runMigrations", () => {
  const createdDirs: string[] = [];
  const createdDbs: string[] = [];

  afterEach(() => {
    for (const dbPath of createdDbs) {
      if (existsSync(dbPath)) {
        rmSync(dbPath, { force: true });
      }
    }

    for (const dirPath of createdDirs) {
      if (existsSync(dirPath)) {
        rmSync(dirPath, { recursive: true, force: true });
      }
    }

    createdDbs.length = 0;
    createdDirs.length = 0;
  });

  it("applies pending SQL migrations and records them", async () => {
    const suffix = randomUUID();
    const migrationsDir = join(tmpdir(), `agent-p-migrations-${suffix}`);
    const dbPath = join(tmpdir(), `agent-p-migrations-${suffix}.db`);
    createdDirs.push(migrationsDir);
    createdDbs.push(dbPath);

    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(
      join(migrationsDir, "0001_init.sql"),
      "CREATE TABLE IF NOT EXISTS sample (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
      "utf8",
    );

    const first = await runMigrations({ migrationsDir, dbPath });
    expect(first.applied).toEqual(["0001_init.sql"]);

    const second = await runMigrations({ migrationsDir, dbPath });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain("0001_init.sql");

    const db = new DatabaseManager(dbPath);
    await db.initialize();
    const row = db.get<{ readonly count: number }>(
      "SELECT COUNT(*) as count FROM _agent_p_migrations",
    );
    db.close();

    expect(row?.count).toBe(1);
  });

  it("rejects edited migration files after they are applied", async () => {
    const suffix = randomUUID();
    const migrationsDir = join(tmpdir(), `agent-p-migrations-${suffix}`);
    const dbPath = join(tmpdir(), `agent-p-migrations-${suffix}.db`);
    createdDirs.push(migrationsDir);
    createdDbs.push(dbPath);

    mkdirSync(migrationsDir, { recursive: true });
    const migrationPath = join(migrationsDir, "0001_init.sql");

    writeFileSync(
      migrationPath,
      "CREATE TABLE IF NOT EXISTS sample (id TEXT PRIMARY KEY NOT NULL);",
      "utf8",
    );
    await runMigrations({ migrationsDir, dbPath });

    writeFileSync(
      migrationPath,
      "CREATE TABLE IF NOT EXISTS sample (id TEXT PRIMARY KEY NOT NULL, extra TEXT);",
      "utf8",
    );

    await expect(runMigrations({ migrationsDir, dbPath })).rejects.toThrow(
      "Migration checksum mismatch for 0001_init.sql",
    );
  });

  it("throws when migrations directory does not exist", async () => {
    const suffix = randomUUID();
    const migrationsDir = join(tmpdir(), `agent-p-missing-${suffix}`);
    const dbPath = join(tmpdir(), `agent-p-missing-${suffix}.db`);
    createdDbs.push(dbPath);

    await expect(runMigrations({ migrationsDir, dbPath })).rejects.toThrow(
      `Migrations directory does not exist: ${migrationsDir}`,
    );
  });

  it("sorts migrations and skips blank sql files", async () => {
    const suffix = randomUUID();
    const migrationsDir = join(tmpdir(), `agent-p-sorted-${suffix}`);
    const dbPath = join(tmpdir(), `agent-p-sorted-${suffix}.db`);
    createdDirs.push(migrationsDir);
    createdDbs.push(dbPath);

    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(join(migrationsDir, "README.txt"), "ignore me", "utf8");
    writeFileSync(
      join(migrationsDir, "0002_second.sql"),
      "CREATE TABLE second_table (id INTEGER PRIMARY KEY NOT NULL);",
      "utf8",
    );
    writeFileSync(join(migrationsDir, "0001_first.sql"), "   \n \t", "utf8");

    const result = await runMigrations({ migrationsDir, dbPath });

    expect(result.applied).toEqual(["0002_second.sql"]);
    expect(result.skipped).toEqual(["0001_first.sql"]);
  });

  it("rolls back and wraps migration execution errors", async () => {
    const suffix = randomUUID();
    const migrationsDir = join(tmpdir(), `agent-p-failing-${suffix}`);
    const dbPath = join(tmpdir(), `agent-p-failing-${suffix}.db`);
    createdDirs.push(migrationsDir);
    createdDbs.push(dbPath);

    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(
      join(migrationsDir, "0001_broken.sql"),
      "CREATE TABLE broken (id INTEGER PRIMARY KEY); INVALID SQL",
      "utf8",
    );

    await expect(runMigrations({ migrationsDir, dbPath })).rejects.toThrow(
      "Failed to apply migration 0001_broken.sql",
    );

    const db = new DatabaseManager(dbPath);
    await db.initialize();
    const row = db.get<{ readonly count: number }>(
      "SELECT COUNT(*) as count FROM _agent_p_migrations",
    );
    db.close();

    expect(row?.count).toBe(0);
  });
});
