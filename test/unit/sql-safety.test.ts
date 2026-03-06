import { describe, expect, it } from "vitest";

import {
  assertSafeSingleStatement,
  sqlQuery,
} from "../../src/db/sql-safety.js";

describe("SQL safety", () => {
  it("builds parameterized queries from template literals", () => {
    const query = sqlQuery`SELECT * FROM memory_entries WHERE key = ${"x' OR 1=1 --"} AND scope = ${"session"}`;

    expect(query.text).toBe(
      "SELECT * FROM memory_entries WHERE key = ? AND scope = ?",
    );
    expect(query.params).toEqual(["x' OR 1=1 --", "session"]);
  });

  it("rejects SQL comment tokens in executable statements", () => {
    expect(() =>
      assertSafeSingleStatement("SELECT * FROM users -- bypass"),
    ).toThrow("SQL comments are not allowed in query statements");
  });

  it("rejects empty SQL statements and null bytes", () => {
    expect(() => assertSafeSingleStatement("   ")).toThrow(
      "SQL statement must be a non-empty string",
    );
    expect(() => assertSafeSingleStatement("SELECT\0 1")).toThrow(
      "SQL statement contains invalid null byte",
    );
  });

  it("rejects multiple statements in a single query", () => {
    expect(() =>
      assertSafeSingleStatement("SELECT * FROM users; DROP TABLE users"),
    ).toThrow("Multiple SQL statements are not allowed");
  });

  it("rejects placeholder and parameter count mismatch", () => {
    expect(() =>
      assertSafeSingleStatement("SELECT * FROM users WHERE id = ?", []),
    ).toThrow("SQL placeholder count (1) does not match parameter count (0)");
  });

  it("rejects placeholders without parameters", () => {
    expect(() =>
      assertSafeSingleStatement("SELECT * FROM users WHERE id = ?"),
    ).toThrow("SQL parameters are required for placeholder bindings");
  });

  it("allows statement terminator and quoted comment-like text", () => {
    expect(() =>
      assertSafeSingleStatement("SELECT '--keep literal--' as marker;"),
    ).not.toThrow();
  });

  it("ignores placeholder and comment-like tokens inside quoted content", () => {
    expect(() =>
      assertSafeSingleStatement(
        'SELECT "--not comment ?" AS marker, """quoted ?""" AS other;',
      ),
    ).not.toThrow();
  });

  it("rejects malformed template literal usage", () => {
    const invalidStrings = [
      "SELECT ",
      " FROM users",
    ] as unknown as TemplateStringsArray;
    expect(() => sqlQuery(invalidStrings, "id", "extra")).toThrow(
      "Invalid SQL template usage",
    );
  });
});
