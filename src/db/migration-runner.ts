import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DatabaseManager } from "./database-manager.js";
import { sqlQuery } from "./sql-safety.js";

const DEFAULT_MIGRATIONS_DIR = resolve("migrations");

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export interface RunMigrationsOptions {
  readonly dbPath?: string;
  readonly migrationsDir?: string;
}

const listMigrationFiles = (migrationsDir: string): string[] => {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory does not exist: ${migrationsDir}`);
  }

  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
};

const sha256 = (content: string): string => {
  return createHash("sha256").update(content, "utf8").digest("hex");
};

const ensureMigrationsTable = (database: DatabaseManager): void => {
  database.run(sqlQuery`
    CREATE TABLE IF NOT EXISTS _agent_p_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
};

const loadApplied = (database: DatabaseManager): Map<string, string> => {
  const rows = database.all<{
    readonly name: string;
    readonly checksum: string;
  }>(
    sqlQuery`
      SELECT name, checksum
      FROM _agent_p_migrations
      ORDER BY name ASC
    `,
  );

  return new Map(rows.map((row) => [row.name, row.checksum]));
};

export const runMigrations = async (
  options: RunMigrationsOptions = {},
): Promise<MigrationResult> => {
  const migrationsDir = resolve(
    options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR,
  );
  const migrationFiles = listMigrationFiles(migrationsDir);
  const database = new DatabaseManager(options.dbPath);
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await database.initialize();
    ensureMigrationsTable(database);
    const existing = loadApplied(database);

    for (const migrationFile of migrationFiles) {
      const migrationPath = resolve(migrationsDir, migrationFile);
      const sqlText = readFileSync(migrationPath, "utf8").trim();
      if (sqlText.length === 0) {
        skipped.push(migrationFile);
        continue;
      }

      const checksum = sha256(sqlText);
      const recordedChecksum = existing.get(migrationFile);
      if (recordedChecksum && recordedChecksum === checksum) {
        skipped.push(migrationFile);
        continue;
      }

      if (recordedChecksum && recordedChecksum !== checksum) {
        throw new Error(
          `Migration checksum mismatch for ${migrationFile}. Create a new migration instead of editing applied files.`,
        );
      }

      try {
        database.exec("BEGIN");
        database.exec(sqlText);
        database.run(
          sqlQuery`
            INSERT INTO _agent_p_migrations (name, checksum, applied_at)
            VALUES (${migrationFile}, ${checksum}, ${Date.now()})
          `,
        );
        database.exec("COMMIT");
        applied.push(migrationFile);
      } catch (error) {
        database.exec("ROLLBACK");
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to apply migration ${migrationFile}: ${message}`,
          { cause: error },
        );
      }
    }

    return { applied, skipped };
  } finally {
    database.close();
  }
};
