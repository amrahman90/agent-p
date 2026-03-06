import { afterEach, describe, expect, it, vi } from "vitest";

const runDbCheckCommand = async (driverInfo: {
  driver: "better-sqlite3" | "sql.js";
  isFallback: boolean;
}) => {
  vi.doMock("../../src/db/database-manager.js", () => {
    class DatabaseManager {
      async initialize() {
        return driverInfo;
      }

      close() {
        return undefined;
      }
    }

    return { DatabaseManager };
  });

  const writes: string[] = [];
  const [{ createCliProgram }, { ServiceContainer }] = await Promise.all([
    import("../../src/cli.js"),
    import("../../src/core/container.js"),
  ]);

  const program = createCliProgram({
    container: new ServiceContainer(),
    stdout: {
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
    },
  });

  await program.parseAsync(["node", "agent-p", "db:check"]);

  return JSON.parse(writes.join("")) as {
    driver: string;
    isFallback: boolean;
  };
};

describe("CLI db:check", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../../src/db/database-manager.js");
  });

  it.each([
    { driver: "better-sqlite3", isFallback: false },
    { driver: "sql.js", isFallback: true },
  ] as const)(
    "prints stable JSON schema for %s driver",
    async (expectedInfo) => {
      const payload = await runDbCheckCommand(expectedInfo);

      expect(payload).toEqual(expectedInfo);
      expect(payload).toEqual({
        driver: expect.any(String),
        isFallback: expect.any(Boolean),
      });
      expect(Object.keys(payload).sort()).toEqual(["driver", "isFallback"]);
      expect(payload.isFallback).toBe(payload.driver === "sql.js");
    },
  );
});
