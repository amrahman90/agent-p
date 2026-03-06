import { describe, expect, it } from "vitest";

import { MemoryManager } from "../../src/memory/manager.js";
import type {
  MemoryEntry,
  MemorySearchOptions,
  MemoryTierStore,
  ScopeRecordInput,
  ScopeRecordKey,
} from "../../src/memory/types.js";

class InMemoryTierStore implements MemoryTierStore {
  private readonly records = new Map<string, MemoryEntry>();

  constructor(private readonly temperature: MemoryEntry["temperature"]) {}

  upsert<T>(input: ScopeRecordInput<T>): MemoryEntry<T> {
    const id = `${input.scope}:${input.scopeId}:${input.key}`;
    const now = Date.now();
    const previous = this.records.get(id);
    const entry: MemoryEntry<T> = {
      id,
      scope: input.scope,
      scopeId: input.scopeId,
      key: input.key,
      value: input.value,
      temperature: this.temperature,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastAccessedAt: previous?.lastAccessedAt ?? now,
      accessCount: previous?.accessCount ?? 0,
    };
    this.records.set(id, entry);
    return entry;
  }

  get<T>(key: ScopeRecordKey): MemoryEntry<T> | undefined {
    const id = `${key.scope}:${key.scopeId}:${key.key}`;
    const hit = this.records.get(id);
    if (!hit) {
      return undefined;
    }
    const touched: MemoryEntry<T> = {
      ...(hit as MemoryEntry<T>),
      accessCount: hit.accessCount + 1,
      lastAccessedAt: Date.now(),
    };
    this.records.set(id, touched);
    return touched;
  }

  delete(key: ScopeRecordKey): boolean {
    return this.records.delete(`${key.scope}:${key.scopeId}:${key.key}`);
  }

  clearScope(scope: ScopeRecordKey["scope"], scopeId: string): number {
    let removed = 0;
    for (const [id, entry] of this.records.entries()) {
      if (entry.scope === scope && entry.scopeId === scopeId) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  list(scope?: ScopeRecordKey["scope"], scopeId?: string): MemoryEntry[] {
    return [...this.records.values()].filter((entry) => {
      if (scope && entry.scope !== scope) {
        return false;
      }
      if (scopeId && entry.scopeId !== scopeId) {
        return false;
      }
      return true;
    });
  }

  search(term: string, options: MemorySearchOptions = {}): MemoryEntry[] {
    const normalized = term.toLowerCase();
    const limit = options.limit ?? 20;
    return this.list(options.scope, options.scopeId)
      .filter((entry) => {
        const value = JSON.stringify(entry.value).toLowerCase();
        return (
          entry.key.toLowerCase().includes(normalized) ||
          value.includes(normalized)
        );
      })
      .slice(0, limit);
  }

  clearAll(): void {
    this.records.clear();
  }
}

describe("MemoryManager", () => {
  it("stores and loads session values from hot tier", () => {
    const manager = new MemoryManager({ sessionId: "run-1" });

    manager.session.save("task-123", { step: "write tests" });

    const entry = manager.session.load<{ step: string }>("task-123");
    expect(entry).toBeDefined();
    expect(entry?.value.step).toBe("write tests");
    expect(entry?.scope).toBe("session");
    expect(entry?.scopeId).toBe("run-1");
    expect(entry?.temperature).toBe("hot");
    expect(entry?.accessCount).toBe(1);
  });

  it("isolates values between scopes", () => {
    const manager = new MemoryManager({
      sessionId: "run-1",
      userId: "user-1",
      appId: "app-1",
    });

    manager.session.set("theme", "session-light");
    manager.user.set("theme", "user-dark");
    manager.shared.set("theme", "shared-blue");
    manager.privateScope("builder").set("theme", "private-green");

    expect(manager.session.get<string>("theme")?.value).toBe("session-light");
    expect(manager.user.get<string>("theme")?.value).toBe("user-dark");
    expect(manager.shared.get<string>("theme")?.value).toBe("shared-blue");
    expect(manager.privateScope("builder").get<string>("theme")?.value).toBe(
      "private-green",
    );
  });

  it("searches only within requested session scope", () => {
    const manager = new MemoryManager();

    manager.session.set("session-note", "Authentication started");
    const otherSession = new MemoryManager({ sessionId: "session-2" });
    otherSession.session.set(
      "session-note",
      "Authentication in another session",
    );
    manager.user.set("pref", "Authentication preferred");
    manager.shared.set("context", "No auth secrets in memory");
    manager
      .privateScope("builder")
      .set("secret", "Authentication private note");

    const currentSession = manager.searchSession("auth", "default-session", 5);
    const secondSession = otherSession.searchSession("auth", "session-2", 5);

    expect(currentSession).toHaveLength(1);
    expect(currentSession[0]?.scope).toBe("session");
    expect(currentSession[0]?.scopeId).toBe("default-session");
    expect(secondSession).toHaveLength(1);
    expect(secondSession[0]?.scope).toBe("session");
    expect(secondSession[0]?.scopeId).toBe("session-2");
    expect(currentSession.every((entry) => entry.temperature === "hot")).toBe(
      true,
    );
    expect(secondSession.every((entry) => entry.temperature === "hot")).toBe(
      true,
    );
  });

  it("clears private scope independently", () => {
    const manager = new MemoryManager({ appId: "app-1" });
    const builderPrivate = manager.privateScope("builder");

    builderPrivate.set("task", "Implement auth");
    builderPrivate.set("status", "in-progress");
    manager.session.set("task", "outside-private");

    const removed = builderPrivate.clear();
    expect(removed).toBe(2);
    expect(builderPrivate.list()).toHaveLength(0);
    expect(manager.session.list()).toHaveLength(1);
  });

  it("isolates private scope per agent id", () => {
    const manager = new MemoryManager({ appId: "app-1" });
    const builderPrivate = manager.privateScope("builder");
    const reviewerPrivate = manager.privateScope("reviewer");

    builderPrivate.set("task", "builder-task");
    reviewerPrivate.set("task", "reviewer-task");

    expect(builderPrivate.get<string>("task")?.value).toBe("builder-task");
    expect(reviewerPrivate.get<string>("task")?.value).toBe("reviewer-task");
    expect(builderPrivate.search("reviewer")).toHaveLength(0);
    expect(reviewerPrivate.search("builder")).toHaveLength(0);
  });

  it("rejects empty scope and key identifiers", () => {
    expect(() => new MemoryManager({ appId: "  " })).toThrow(
      "scopeId must be a non-empty string",
    );

    const manager = new MemoryManager();
    expect(() => manager.privateScope("   ")).toThrow(
      "agentId must be a non-empty string",
    );
    expect(() => manager.session.set("  ", "x")).toThrow(
      "memory key must be a non-empty string",
    );
    expect(() => manager.searchSession("auth", "   ", 5)).toThrow(
      "scopeId must be a non-empty string",
    );
  });

  it("normalizes session id before scoped search", () => {
    const manager = new MemoryManager({ sessionId: "session-1" });
    manager.session.set("auth-note", "Authentication started");

    const results = manager.searchSession("auth", "  session-1  ", 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.scope).toBe("session");
    expect(results[0]?.scopeId).toBe("session-1");
  });

  it("promotes warm hits into hot tier on get", () => {
    const warmStore = new InMemoryTierStore("warm");
    warmStore.upsert({
      scope: "session",
      scopeId: "session-w1",
      key: "auth-note",
      value: "warm auth memory",
    });

    const manager = new MemoryManager({
      sessionId: "session-w1",
      warm: { store: warmStore },
      cold: false,
    });

    expect(manager.session.get<string>("auth-note")?.temperature).toBe("hot");
    expect(
      manager
        .searchAll("warm auth")
        .some((entry) => entry.temperature === "hot"),
    ).toBe(true);
  });

  it("promotes cold hits into warm and hot tiers on get", () => {
    const warmStore = new InMemoryTierStore("warm");
    const coldStore = new InMemoryTierStore("cold");
    coldStore.upsert({
      scope: "session",
      scopeId: "session-c1",
      key: "archive-note",
      value: "cold archive auth note",
    });

    const manager = new MemoryManager({
      sessionId: "session-c1",
      warm: { store: warmStore },
      cold: { store: coldStore },
    });

    const loaded = manager.session.get<string>("archive-note");
    expect(loaded?.temperature).toBe("hot");
    expect(
      warmStore.get<string>({
        scope: "session",
        scopeId: "session-c1",
        key: "archive-note",
      })?.temperature,
    ).toBe("warm");
  });

  it("keeps clear/delete/search consistent across warm and cold tiers", () => {
    const warmStore = new InMemoryTierStore("warm");
    const coldStore = new InMemoryTierStore("cold");
    const manager = new MemoryManager({
      sessionId: "session-x1",
      warm: { store: warmStore },
      cold: { store: coldStore },
    });

    manager.session.set("shared-key", "value-on-all-tiers");

    expect(
      manager.searchSession("value-on-all-tiers", "session-x1", 5),
    ).toHaveLength(1);
    expect(manager.session.delete("shared-key")).toBe(true);
    expect(
      warmStore.get({
        scope: "session",
        scopeId: "session-x1",
        key: "shared-key",
      }),
    ).toBeUndefined();
    expect(
      coldStore.get({
        scope: "session",
        scopeId: "session-x1",
        key: "shared-key",
      }),
    ).toBeUndefined();
  });
});
