import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const createTempDbPath = (): string =>
  join(tmpdir(), `agent-p-db-manager-${randomUUID()}.db`);

describe("DatabaseManager driver selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("better-sqlite3");
    vi.doUnmock("sql.js");
  });

  it("throws when reading driver info before initialize", async () => {
    const { DatabaseManager } =
      await import("../../src/db/database-manager.js");
    const target = new DatabaseManager(createTempDbPath());

    expect(() => target.getDriverInfo()).toThrow(
      "DatabaseManager is not initialized",
    );
  });

  it("throws for database operations before initialize", async () => {
    const { DatabaseManager } =
      await import("../../src/db/database-manager.js");
    const target = new DatabaseManager(createTempDbPath());

    expect(() => target.exec("SELECT 1")).toThrow(
      "DatabaseManager is not initialized",
    );
    expect(() => target.run("SELECT 1")).toThrow(
      "DatabaseManager is not initialized",
    );
    expect(() => target.get("SELECT 1")).toThrow(
      "DatabaseManager is not initialized",
    );
    expect(() => target.all("SELECT 1")).toThrow(
      "DatabaseManager is not initialized",
    );
  });

  it("uses better-sqlite3 when native driver is available", async () => {
    const dbPath = createTempDbPath();
    const run = vi.fn();
    const get = vi.fn(() => ({ id: 7 }));
    const all = vi.fn(() => [{ id: 7 }]);
    const prepare = vi.fn(() => ({ run, get, all }));
    const exec = vi.fn();
    const close = vi.fn();

    const betterSqliteCtor = vi.fn(function BetterSqliteMock() {
      return { prepare, exec, close };
    });
    vi.doMock("better-sqlite3", () => ({ default: betterSqliteCtor }));
    vi.doMock("sql.js", () => ({
      default: vi.fn(async () => ({
        Database: class SqlJsUnusedMock {},
      })),
    }));

    const { DatabaseManager } =
      await import("../../src/db/database-manager.js");
    const target = new DatabaseManager(dbPath);

    const info = await target.initialize();
    expect(info).toEqual({ driver: "better-sqlite3", isFallback: false });

    const secondInfo = await target.initialize();
    expect(secondInfo).toBe(info);
    expect(betterSqliteCtor).toHaveBeenCalledTimes(1);

    target.run("INSERT INTO demo (id) VALUES (?)", [7]);
    expect(run).toHaveBeenCalledWith(7);

    const row = target.get<{ id: number }>(
      "SELECT id FROM demo WHERE id = ?",
      [7],
    );
    expect(row).toEqual({ id: 7 });

    const rows = target.all<{ id: number }>("SELECT id FROM demo");
    expect(rows).toEqual([{ id: 7 }]);

    target.exec("CREATE TABLE demo (id INTEGER)");
    expect(exec).toHaveBeenCalledWith("CREATE TABLE demo (id INTEGER)");

    target.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("falls back to sql.js when better-sqlite3 initialization fails", async () => {
    const dbPath = createTempDbPath();

    vi.doMock("better-sqlite3", () => {
      throw new Error("native driver unavailable");
    });

    const statementForRows = (rows: Array<Record<string, unknown>>) => {
      let index = 0;
      return {
        bind: vi.fn(),
        step: vi.fn(() => index < rows.length),
        getAsObject: vi.fn(() => rows[index++] ?? {}),
        free: vi.fn(),
      };
    };

    const sqlJsDatabase = {
      run: vi.fn(),
      prepare: vi.fn((sql: string) => {
        if (sql.includes("one_row")) {
          return statementForRows([{ id: 1 }]);
        }

        if (sql.includes("many_rows")) {
          return statementForRows([{ id: 1 }, { id: 2 }]);
        }

        return statementForRows([]);
      }),
      exec: vi.fn(),
      export: vi.fn(() => new Uint8Array([1, 2, 3])),
      close: vi.fn(),
    };

    const sqlJsCtor = vi.fn(function SqlJsDatabaseMock() {
      return sqlJsDatabase;
    });
    const sqlJsFactory = vi.fn(async () => ({ Database: sqlJsCtor }));
    vi.doMock("sql.js", () => ({ default: sqlJsFactory }));

    const { DatabaseManager } =
      await import("../../src/db/database-manager.js");
    const target = new DatabaseManager(dbPath);

    const info = await target.initialize();
    expect(info).toEqual({ driver: "sql.js", isFallback: true });

    target.run("CREATE TABLE demo (id INTEGER)");
    expect(sqlJsDatabase.run).toHaveBeenCalledTimes(1);

    const row = target.get<{ id: number }>("SELECT id FROM one_row");
    expect(row).toEqual({ id: 1 });

    const rows = target.all<{ id: number }>("SELECT id FROM many_rows");
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);

    target.close();
    expect(sqlJsDatabase.export).toHaveBeenCalledTimes(1);
    expect(sqlJsDatabase.close).toHaveBeenCalledTimes(1);
    expect(existsSync(dbPath)).toBe(true);

    rmSync(dbPath, { force: true });
  });

  it("loads sql.js from persisted file and handles empty query results", async () => {
    const dbPath = createTempDbPath();
    writeFileSync(dbPath, Buffer.from([4, 5, 6]));

    vi.doMock("better-sqlite3", () => {
      throw new Error("native driver unavailable");
    });

    const emptyStatement = {
      bind: vi.fn(),
      step: vi.fn(() => false),
      getAsObject: vi.fn(() => ({})),
      free: vi.fn(),
    };

    const sqlJsDatabase = {
      run: vi.fn(),
      prepare: vi.fn(() => emptyStatement),
      exec: vi.fn(),
      export: vi.fn(() => new Uint8Array([9, 9, 9])),
      close: vi.fn(),
    };

    const sqlJsCtor = vi.fn(function SqlJsDatabaseMock() {
      return sqlJsDatabase;
    });

    const sqlJsFactory = vi.fn(async () => ({ Database: sqlJsCtor }));
    vi.doMock("sql.js", () => ({ default: sqlJsFactory }));

    const { DatabaseManager } =
      await import("../../src/db/database-manager.js");
    const target = new DatabaseManager(dbPath);

    await target.initialize();

    expect(sqlJsCtor).toHaveBeenCalledTimes(1);
    expect(sqlJsCtor).toHaveBeenCalledWith(expect.any(Uint8Array));

    expect(target.get("SELECT id FROM none")).toBeUndefined();
    expect(target.all("SELECT id FROM none")).toEqual([]);

    target.close();
    rmSync(dbPath, { force: true });
  });
});
