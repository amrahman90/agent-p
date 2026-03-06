export type MemoryScope = "session" | "user" | "shared" | "private";

export type MemoryTemperature = "hot" | "warm" | "cold";

export interface MemoryEntry<T = unknown> {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly scopeId: string;
  readonly key: string;
  readonly value: T;
  readonly temperature: MemoryTemperature;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastAccessedAt: number;
  readonly accessCount: number;
}

export interface MemorySearchOptions {
  readonly limit?: number;
  readonly scope?: MemoryScope;
  readonly scopeId?: string;
}

export interface HotTierConfig {
  readonly maxEntries: number;
  readonly ttlMs: number;
  readonly maxSize: number;
}

export interface WarmTierConfig {
  readonly dbPath: string;
  readonly maxSearchResults: number;
}

export interface ColdTierConfig {
  readonly archivePath: string;
  readonly maxEntries: number;
}

export interface MemoryTierPolicy {
  readonly warmSearchLimit: number;
  readonly coldSearchLimit: number;
  readonly retainHotMs: number;
}

export interface ScopeRecordInput<T = unknown> {
  readonly scope: MemoryScope;
  readonly scopeId: string;
  readonly key: string;
  readonly value: T;
}

export interface ScopeRecordKey {
  readonly scope: MemoryScope;
  readonly scopeId: string;
  readonly key: string;
}

export interface MemoryTierStore {
  upsert<T>(input: ScopeRecordInput<T>): MemoryEntry<T>;
  get<T>(key: ScopeRecordKey): MemoryEntry<T> | undefined;
  delete(key: ScopeRecordKey): boolean;
  clearScope(scope: ScopeRecordKey["scope"], scopeId: string): number;
  list(scope?: ScopeRecordKey["scope"], scopeId?: string): MemoryEntry[];
  search(term: string, options?: MemorySearchOptions): MemoryEntry[];
  clearAll(): void;
}
