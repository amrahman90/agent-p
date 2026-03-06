import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ColdMemoryStore } from "../../src/memory/tiered/cold.js";
import { WarmMemoryStore } from "../../src/memory/tiered/warm.js";
import type {
  MemoryEntry,
  MemorySearchOptions,
  ScopeRecordInput,
  ScopeRecordKey,
} from "../../src/memory/types.js";

interface StubStore {
  upsert<T>(input: ScopeRecordInput<T>): MemoryEntry<T>;
  get<T>(key: ScopeRecordKey): MemoryEntry<T> | undefined;
  delete(key: ScopeRecordKey): boolean;
  clearScope(scope: ScopeRecordKey["scope"], scopeId: string): number;
  list(scope?: ScopeRecordKey["scope"], scopeId?: string): MemoryEntry[];
  search(term: string, options?: MemorySearchOptions): MemoryEntry[];
  clearAll(): void;
}

const tempDirs: string[] = [];

const createTempArchivePath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "agent-p-memory-"));
  tempDirs.push(dir);
  return join(dir, "cold", "archive.jsonl");
};

afterEach(() => {
  vi.useRealTimers();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("ColdMemoryStore", () => {
  it("supports persist/search/filter/delete lifecycle", () => {
    const archivePath = createTempArchivePath();
    const store = new ColdMemoryStore(archivePath, 10);

    store.upsert({
      scope: "session",
      scopeId: "s-1",
      key: "alpha-note",
      value: { tag: "keep" },
    });
    store.upsert({
      scope: "user",
      scopeId: "u-1",
      key: "beta-note",
      value: "value",
    });

    expect(store.search("", { limit: 5 })).toEqual([]);
    expect(store.list()).toHaveLength(2);
    expect(store.list("session", "s-1")).toHaveLength(1);
    expect(
      store.search("keep", { scope: "session", scopeId: "s-1", limit: 5 }),
    ).toHaveLength(1);

    const touched = store.get({
      scope: "session",
      scopeId: "s-1",
      key: "alpha-note",
    });
    expect(touched?.accessCount).toBe(1);

    expect(
      store.delete({ scope: "session", scopeId: "s-1", key: "missing" }),
    ).toBe(false);
    expect(
      store.delete({ scope: "user", scopeId: "u-1", key: "beta-note" }),
    ).toBe(true);
    expect(store.clearScope("session", "s-1")).toBe(1);
    expect(store.clearScope("session", "s-1")).toBe(0);

    store.clearAll();
    store.clearAll();
    expect(store.list()).toHaveLength(0);
  });

  it("evicts oldest entry when max capacity is exceeded", () => {
    vi.useFakeTimers();

    const archivePath = createTempArchivePath();
    const store = new ColdMemoryStore(archivePath, 1);

    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
    store.upsert({
      scope: "session",
      scopeId: "s-1",
      key: "old",
      value: "first",
    });

    vi.setSystemTime(new Date("2026-03-06T10:00:01.000Z"));
    store.upsert({
      scope: "session",
      scopeId: "s-1",
      key: "new",
      value: "second",
    });

    expect(
      store.get({ scope: "session", scopeId: "s-1", key: "old" }),
    ).toBeUndefined();
    expect(
      store.get({ scope: "session", scopeId: "s-1", key: "new" })?.value,
    ).toBe("second");
  });

  it("loads persisted JSONL entries at startup", () => {
    const archivePath = createTempArchivePath();
    mkdirSync(dirname(archivePath), { recursive: true });
    writeFileSync(
      archivePath,
      `${JSON.stringify({
        id: "session:s-1:cached",
        scope: "session",
        scopeId: "s-1",
        key: "cached",
        value: "from-disk",
        createdAt: 1,
        updatedAt: 2,
        accessCount: 3,
        lastAccessedAt: 4,
      })}\n\n`,
      "utf8",
    );

    const store = new ColdMemoryStore(archivePath, 5);
    expect(
      store.get({ scope: "session", scopeId: "s-1", key: "cached" })?.value,
    ).toBe("from-disk");
  });

  it("validates search limit", () => {
    const archivePath = createTempArchivePath();
    const store = new ColdMemoryStore(archivePath, 10);

    expect(() => store.search("value", { limit: 0 })).toThrow(
      "search limit must be a positive integer",
    );
  });
});

describe("WarmMemoryStore", () => {
  it("normalizes search limit and delegates to backing store", () => {
    const searchSpy = vi.fn(() => [] as MemoryEntry[]);
    const backingStore: StubStore = {
      upsert: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      clearScope: vi.fn(),
      list: vi.fn(() => []),
      search: searchSpy,
      clearAll: vi.fn(),
    };

    const store = new WarmMemoryStore(backingStore as never, 42);
    store.search("alpha", {});
    store.search("beta", { limit: 5 });

    expect(searchSpy).toHaveBeenNthCalledWith(1, "alpha", { limit: 42 });
    expect(searchSpy).toHaveBeenNthCalledWith(2, "beta", { limit: 5 });
  });

  it("rejects invalid constructor or search limits", () => {
    const backingStore: StubStore = {
      upsert: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      clearScope: vi.fn(),
      list: vi.fn(() => []),
      search: vi.fn(() => []),
      clearAll: vi.fn(),
    };

    expect(() => new WarmMemoryStore(backingStore as never, 0)).toThrow(
      "search limit must be a positive integer",
    );

    const store = new WarmMemoryStore(backingStore as never, 10);
    expect(() => store.search("alpha", { limit: -1 })).toThrow(
      "search limit must be a positive integer",
    );
  });
});
