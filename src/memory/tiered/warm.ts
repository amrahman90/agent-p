import { DatabaseManager } from "../../db/database-manager.js";
import { SqliteMemoryStore } from "../store.js";
import type {
  MemoryEntry,
  MemorySearchOptions,
  MemoryTierStore,
  ScopeRecordInput,
  ScopeRecordKey,
  WarmTierConfig,
} from "../types.js";

const DEFAULT_WARM_SEARCH_RESULTS = 100;

const normalizeLimit = (
  limit: number | undefined,
  fallback: number,
): number => {
  if (limit === undefined) {
    return fallback;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("search limit must be a positive integer");
  }

  return limit;
};

export class WarmMemoryStore implements MemoryTierStore {
  private readonly maxSearchResults: number;

  constructor(
    private readonly store: SqliteMemoryStore,
    maxSearchResults: number = DEFAULT_WARM_SEARCH_RESULTS,
  ) {
    this.maxSearchResults = normalizeLimit(
      maxSearchResults,
      DEFAULT_WARM_SEARCH_RESULTS,
    );
  }

  static async create(config: WarmTierConfig): Promise<WarmMemoryStore> {
    const database = new DatabaseManager(config.dbPath);
    const store = new SqliteMemoryStore(database);
    await store.initialize();
    return new WarmMemoryStore(store, config.maxSearchResults);
  }

  upsert<T>(input: ScopeRecordInput<T>): MemoryEntry<T> {
    return this.store.upsert(input);
  }

  get<T>(key: ScopeRecordKey): MemoryEntry<T> | undefined {
    return this.store.get<T>(key);
  }

  delete(key: ScopeRecordKey): boolean {
    return this.store.delete(key);
  }

  clearScope(scope: ScopeRecordKey["scope"], scopeId: string): number {
    return this.store.clearScope(scope, scopeId);
  }

  list(scope?: ScopeRecordKey["scope"], scopeId?: string): MemoryEntry[] {
    return this.store.list(scope, scopeId);
  }

  search(term: string, options: MemorySearchOptions = {}): MemoryEntry[] {
    const limit = normalizeLimit(options.limit, this.maxSearchResults);
    return this.store.search(term, { ...options, limit });
  }

  clearAll(): void {
    this.store.clearAll();
  }
}
