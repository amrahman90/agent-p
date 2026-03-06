import { randomUUID } from "node:crypto";

import { LRUCache } from "lru-cache";

import type {
  HotTierConfig,
  MemoryEntry,
  MemorySearchOptions,
  ScopeRecordInput,
  ScopeRecordKey,
} from "../types.js";

const buildEntryId = (scope: string, scopeId: string, key: string): string => {
  return `${scope}:${scopeId}:${key}`;
};

const normalizeText = (value: unknown): string => {
  if (typeof value === "string") {
    return value.toLowerCase();
  }

  return JSON.stringify(value).toLowerCase();
};

const toByteSize = (entry: MemoryEntry): number => {
  return Buffer.byteLength(JSON.stringify(entry), "utf8");
};

export class HotMemoryStore {
  private readonly cache: LRUCache<string, MemoryEntry>;

  constructor(
    private readonly config: HotTierConfig,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.cache = new LRUCache<string, MemoryEntry>({
      max: config.maxEntries,
      maxSize: config.maxSize,
      ttl: config.ttlMs,
      sizeCalculation: (value) => toByteSize(value),
      updateAgeOnGet: false,
      allowStale: false,
    });
  }

  upsert<T>(input: ScopeRecordInput<T>): MemoryEntry<T> {
    const cacheKey = buildEntryId(input.scope, input.scopeId, input.key);
    const timestamp = this.now();
    const previous = this.cache.get(cacheKey);

    const entry: MemoryEntry<T> = {
      id: previous?.id ?? randomUUID(),
      scope: input.scope,
      scopeId: input.scopeId,
      key: input.key,
      value: input.value,
      temperature: "hot",
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastAccessedAt: previous?.lastAccessedAt ?? timestamp,
      accessCount: previous?.accessCount ?? 0,
    };

    this.cache.set(cacheKey, entry);
    return entry;
  }

  get<T>(key: ScopeRecordKey): MemoryEntry<T> | undefined {
    const cacheKey = buildEntryId(key.scope, key.scopeId, key.key);
    const hit = this.cache.get(cacheKey);

    if (!hit) {
      return undefined;
    }

    const touched: MemoryEntry<T> = {
      ...(hit as MemoryEntry<T>),
      accessCount: hit.accessCount + 1,
      lastAccessedAt: this.now(),
    };

    this.cache.set(cacheKey, touched);
    return touched;
  }

  delete(key: ScopeRecordKey): boolean {
    const cacheKey = buildEntryId(key.scope, key.scopeId, key.key);
    return this.cache.delete(cacheKey);
  }

  clearScope(scope: ScopeRecordKey["scope"], scopeId: string): number {
    let removedCount = 0;

    for (const cacheKey of this.cache.keys()) {
      const entry = this.cache.get(cacheKey);
      if (!entry) {
        continue;
      }

      if (entry.scope === scope && entry.scopeId === scopeId) {
        this.cache.delete(cacheKey);
        removedCount += 1;
      }
    }

    return removedCount;
  }

  list(scope?: ScopeRecordKey["scope"], scopeId?: string): MemoryEntry[] {
    const results: MemoryEntry[] = [];

    for (const entry of this.cache.values()) {
      if (scope && entry.scope !== scope) {
        continue;
      }

      if (scopeId && entry.scopeId !== scopeId) {
        continue;
      }

      results.push(entry);
    }

    return results;
  }

  search(term: string, options: MemorySearchOptions = {}): MemoryEntry[] {
    const normalizedTerm = term.toLowerCase();
    const limit = options.limit ?? 20;
    const results: MemoryEntry[] = [];

    for (const entry of this.cache.values()) {
      if (options.scope && entry.scope !== options.scope) {
        continue;
      }

      if (options.scopeId && entry.scopeId !== options.scopeId) {
        continue;
      }

      const inKey = entry.key.toLowerCase().includes(normalizedTerm);
      const inValue = normalizeText(entry.value).includes(normalizedTerm);
      if (!inKey && !inValue) {
        continue;
      }

      results.push(entry);
      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  clearAll(): void {
    this.cache.clear();
  }
}
