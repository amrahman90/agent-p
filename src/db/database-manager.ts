import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Database as BetterSqliteDatabase } from "better-sqlite3";

import {
  assertSafeSingleStatement,
  type ParameterizedQuery,
} from "./sql-safety.js";

export type SqliteDriver = "better-sqlite3" | "sql.js";

export interface DriverInfo {
  readonly driver: SqliteDriver;
  readonly isFallback: boolean;
}

interface DatabaseAdapter {
  run(sql: string, params?: readonly unknown[]): void;
  get<T>(sql: string, params?: readonly unknown[]): T | undefined;
  all<T>(sql: string, params?: readonly unknown[]): T[];
  exec(sql: string): void;
  close(): void;
}

const DEFAULT_DB_PATH = resolve(".agent-p/agent-p.db");

const ensureParentDirectory = (filePath: string): void => {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
};

const toParamArray = (params?: readonly unknown[]): unknown[] => {
  if (!params) {
    return [];
  }

  return [...params];
};

const normalizeStatement = (
  sqlOrQuery: string | ParameterizedQuery,
  params?: readonly unknown[],
): {
  readonly sql: string;
  readonly params: readonly unknown[] | undefined;
} => {
  if (typeof sqlOrQuery === "string") {
    assertSafeSingleStatement(sqlOrQuery, params);
    return { sql: sqlOrQuery, params };
  }

  assertSafeSingleStatement(sqlOrQuery.text, sqlOrQuery.params);
  return { sql: sqlOrQuery.text, params: sqlOrQuery.params };
};

export class DatabaseManager {
  private db: DatabaseAdapter | undefined;
  private driverInfo: DriverInfo | undefined;

  constructor(private readonly dbPath: string = DEFAULT_DB_PATH) {}

  async initialize(): Promise<DriverInfo> {
    if (this.db && this.driverInfo) {
      return this.driverInfo;
    }

    ensureParentDirectory(this.dbPath);

    try {
      const sqliteModule = await import("better-sqlite3");
      const BetterSqlite3 = sqliteModule.default as unknown as {
        new (path: string): BetterSqliteDatabase;
      };
      const database = new BetterSqlite3(this.dbPath);

      this.db = {
        run: (sql, params) => {
          database.prepare(sql).run(...toParamArray(params));
        },
        get: <T>(sql: string, params?: readonly unknown[]) => {
          return database.prepare(sql).get(...toParamArray(params)) as
            | T
            | undefined;
        },
        all: <T>(sql: string, params?: readonly unknown[]) => {
          return database.prepare(sql).all(...toParamArray(params)) as T[];
        },
        exec: (sql) => {
          database.exec(sql);
        },
        close: () => {
          database.close();
        },
      };

      this.driverInfo = { driver: "better-sqlite3", isFallback: false };
      return this.driverInfo;
    } catch {
      const sqlJsModule = (await import("sql.js")) as {
        default: (options?: unknown) => Promise<{
          Database: new (buffer?: Uint8Array | Buffer) => {
            run(sql: string, params?: unknown[]): void;
            prepare(sql: string): {
              bind(params?: unknown[]): void;
              step(): boolean;
              getAsObject(): Record<string, unknown>;
              free(): void;
            };
            exec(sql: string): void;
            export(): Uint8Array;
            close(): void;
          };
        }>;
      };
      const SQL = await sqlJsModule.default({});
      const database = existsSync(this.dbPath)
        ? new SQL.Database(readFileSync(this.dbPath))
        : new SQL.Database();

      this.db = {
        run: (sql, params) => {
          database.run(sql, toParamArray(params));
        },
        get: <T>(sql: string, params?: readonly unknown[]) => {
          const stmt = database.prepare(sql);
          stmt.bind(toParamArray(params));

          if (stmt.step()) {
            const row = stmt.getAsObject() as T;
            stmt.free();
            return row;
          }

          stmt.free();
          return undefined;
        },
        all: <T>(sql: string, params?: readonly unknown[]) => {
          const rows: T[] = [];
          const stmt = database.prepare(sql);
          stmt.bind(toParamArray(params));

          while (stmt.step()) {
            rows.push(stmt.getAsObject() as T);
          }

          stmt.free();
          return rows;
        },
        exec: (sql) => {
          database.exec(sql);
        },
        close: () => {
          const persistedData = database.export();
          writeFileSync(this.dbPath, Buffer.from(persistedData));
          database.close();
        },
      };

      this.driverInfo = { driver: "sql.js", isFallback: true };
      return this.driverInfo;
    }
  }

  getDriverInfo(): DriverInfo {
    if (!this.driverInfo) {
      throw new Error("DatabaseManager is not initialized");
    }

    return this.driverInfo;
  }

  exec(sql: string): void {
    if (!this.db) {
      throw new Error("DatabaseManager is not initialized");
    }

    this.db.exec(sql);
  }

  run(
    sqlOrQuery: string | ParameterizedQuery,
    params?: readonly unknown[],
  ): void {
    if (!this.db) {
      throw new Error("DatabaseManager is not initialized");
    }

    const statement = normalizeStatement(sqlOrQuery, params);
    this.db.run(statement.sql, statement.params);
  }

  get<T>(
    sqlOrQuery: string | ParameterizedQuery,
    params?: readonly unknown[],
  ): T | undefined {
    if (!this.db) {
      throw new Error("DatabaseManager is not initialized");
    }

    const statement = normalizeStatement(sqlOrQuery, params);
    return this.db.get<T>(statement.sql, statement.params);
  }

  all<T>(
    sqlOrQuery: string | ParameterizedQuery,
    params?: readonly unknown[],
  ): T[] {
    if (!this.db) {
      throw new Error("DatabaseManager is not initialized");
    }

    const statement = normalizeStatement(sqlOrQuery, params);
    return this.db.all<T>(statement.sql, statement.params);
  }

  close(): void {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = undefined;
    this.driverInfo = undefined;
  }
}
