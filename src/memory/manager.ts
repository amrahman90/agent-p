import { SharedScope } from "./scopes/shared.js";
import { PrivateScope } from "./scopes/private.js";
import { SessionScope } from "./scopes/session.js";
import { UserScope } from "./scopes/user.js";
import { HotMemoryStore } from "./tiered/hot.js";
import { ColdMemoryStore } from "./tiered/cold.js";
import type {
  ColdTierConfig,
  HotTierConfig,
  MemoryEntry,
  MemoryTierPolicy,
  MemoryTierStore,
  WarmTierConfig,
} from "./types.js";
import { validateAgentId, validateScopeId } from "./validation.js";

const DEFAULT_HOT_CONFIG: HotTierConfig = {
  maxEntries: 1000,
  ttlMs: 5 * 60 * 1000,
  maxSize: 10 * 1024 * 1024,
};

const DEFAULT_COLD_CONFIG: ColdTierConfig = {
  archivePath: ".agent-p/memory/cold.jsonl",
  maxEntries: 20000,
};

const DEFAULT_TIER_POLICY: MemoryTierPolicy = {
  warmSearchLimit: 100,
  coldSearchLimit: 50,
  retainHotMs: 5 * 60 * 1000,
};

const toRecordKey = (
  entry: Pick<MemoryEntry, "scope" | "scopeId" | "key">,
): string => `${entry.scope}:${entry.scopeId}:${entry.key}`;

const compareEntries = (left: MemoryEntry, right: MemoryEntry): number => {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }

  if (left.scope !== right.scope) {
    return left.scope.localeCompare(right.scope);
  }

  if (left.scopeId !== right.scopeId) {
    return left.scopeId.localeCompare(right.scopeId);
  }

  return left.key.localeCompare(right.key);
};

const normalizePositiveInteger = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }

  return value;
};

const normalizeNonNegativeInteger = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return value;
};

class TieredMemoryStore implements MemoryTierStore {
  constructor(
    private readonly hot: HotMemoryStore,
    private readonly warm: MemoryTierStore | undefined,
    private readonly cold: MemoryTierStore | undefined,
    private readonly policy: MemoryTierPolicy,
  ) {}

  upsert<T>(input: {
    readonly scope: MemoryEntry["scope"];
    readonly scopeId: string;
    readonly key: string;
    readonly value: T;
  }): MemoryEntry<T> {
    const hotEntry = this.hot.upsert(input);
    this.warm?.upsert(input);

    if (this.cold && this.policy.retainHotMs === 0) {
      this.cold.upsert(input);
    }

    return hotEntry;
  }

  get<T>(key: {
    readonly scope: MemoryEntry["scope"];
    readonly scopeId: string;
    readonly key: string;
  }): MemoryEntry<T> | undefined {
    const hotHit = this.hot.get<T>(key);
    if (hotHit) {
      return hotHit;
    }

    const warmHit = this.warm?.get<T>(key);
    if (warmHit) {
      return this.hot.upsert({
        scope: warmHit.scope,
        scopeId: warmHit.scopeId,
        key: warmHit.key,
        value: warmHit.value,
      });
    }

    const coldHit = this.cold?.get<T>(key);
    if (!coldHit) {
      return undefined;
    }

    this.warm?.upsert({
      scope: coldHit.scope,
      scopeId: coldHit.scopeId,
      key: coldHit.key,
      value: coldHit.value,
    });

    return this.hot.upsert({
      scope: coldHit.scope,
      scopeId: coldHit.scopeId,
      key: coldHit.key,
      value: coldHit.value,
    });
  }

  delete(key: {
    readonly scope: MemoryEntry["scope"];
    readonly scopeId: string;
    readonly key: string;
  }): boolean {
    const hotDeleted = this.hot.delete(key);
    const warmDeleted = this.warm?.delete(key) ?? false;
    const coldDeleted = this.cold?.delete(key) ?? false;

    return hotDeleted || warmDeleted || coldDeleted;
  }

  clearScope(scope: MemoryEntry["scope"], scopeId: string): number {
    const hotRemoved = this.hot.clearScope(scope, scopeId);
    const warmRemoved = this.warm?.clearScope(scope, scopeId) ?? 0;
    const coldRemoved = this.cold?.clearScope(scope, scopeId) ?? 0;
    return hotRemoved + warmRemoved + coldRemoved;
  }

  list(scope?: MemoryEntry["scope"], scopeId?: string): MemoryEntry[] {
    return this.combineTierEntries({
      hot: this.hot.list(scope, scopeId),
      warm: this.warm?.list(scope, scopeId) ?? [],
      cold: this.cold?.list(scope, scopeId) ?? [],
      limit: Number.POSITIVE_INFINITY,
    });
  }

  search(
    term: string,
    options: {
      readonly limit?: number;
      readonly scope?: MemoryEntry["scope"];
      readonly scopeId?: string;
    } = {},
  ): MemoryEntry[] {
    const requestedLimit = options.limit ?? 20;
    const limit = normalizePositiveInteger(requestedLimit, "search limit");

    const hotResults = this.hot.search(term, {
      ...options,
      limit,
    });
    const warmResults =
      this.warm?.search(term, {
        ...options,
        limit: Math.min(limit, this.policy.warmSearchLimit),
      }) ?? [];
    const coldResults =
      this.cold?.search(term, {
        ...options,
        limit: Math.min(limit, this.policy.coldSearchLimit),
      }) ?? [];

    const combined = this.combineTierEntries({
      hot: hotResults,
      warm: warmResults,
      cold: coldResults,
      limit,
    });

    for (const entry of warmResults) {
      this.hot.upsert({
        scope: entry.scope,
        scopeId: entry.scopeId,
        key: entry.key,
        value: entry.value,
      });
    }

    for (const entry of coldResults) {
      this.warm?.upsert({
        scope: entry.scope,
        scopeId: entry.scopeId,
        key: entry.key,
        value: entry.value,
      });
      this.hot.upsert({
        scope: entry.scope,
        scopeId: entry.scopeId,
        key: entry.key,
        value: entry.value,
      });
    }

    return combined;
  }

  clearAll(): void {
    this.hot.clearAll();
    this.warm?.clearAll();
    this.cold?.clearAll();
  }

  private combineTierEntries(input: {
    readonly hot: readonly MemoryEntry[];
    readonly warm: readonly MemoryEntry[];
    readonly cold: readonly MemoryEntry[];
    readonly limit: number;
  }): MemoryEntry[] {
    const merged = new Map<string, MemoryEntry>();

    for (const entry of input.cold) {
      merged.set(toRecordKey(entry), entry);
    }

    for (const entry of input.warm) {
      merged.set(toRecordKey(entry), entry);
    }

    for (const entry of input.hot) {
      merged.set(toRecordKey(entry), entry);
    }

    return [...merged.values()].sort(compareEntries).slice(0, input.limit);
  }
}

export interface MemoryManagerOptions {
  readonly sessionId?: string;
  readonly userId?: string;
  readonly appId?: string;
  readonly hot?: Partial<HotTierConfig>;
  readonly warm?:
    | (Partial<WarmTierConfig> & { readonly store?: MemoryTierStore })
    | false;
  readonly cold?:
    | (Partial<ColdTierConfig> & { readonly store?: MemoryTierStore })
    | false;
  readonly policy?: Partial<MemoryTierPolicy>;
  readonly now?: () => number;
}

/**
 * Memory Manager - Tiered memory storage system with hot/warm/cold architecture
 *
 * @remarks
 * Provides a multi-tier memory system for storing and retrieving context across agent sessions.
 * - **Hot tier**: In-memory LRU cache with TTL for immediate access
 * - **Warm tier**: SQLite-backed storage for persistent but faster access
 * - **Cold tier**: JSONL archive for long-term storage
 *
 * @example
 * ```typescript
 * const memory = new MemoryManager({
 *   appId: 'my-app',
 *   sessionId: 'session-123',
 *   hot: { maxEntries: 1000, ttlMs: 60000 },
 *   warm: { store: warmStore },
 *   cold: { archivePath: './archives' }
 * });
 *
 * // Store in session scope
 * memory.session.set('user-pref', { theme: 'dark' });
 *
 * // Search across all scopes
 * const results = memory.searchAll('user', 10);
 * ```
 */
export class MemoryManager {
  readonly session: SessionScope;
  readonly user: UserScope;
  readonly shared: SharedScope;

  private readonly memoryStore: TieredMemoryStore;
  private readonly appId: string;

  constructor(options: MemoryManagerOptions = {}) {
    const hotConfig: HotTierConfig = {
      ...DEFAULT_HOT_CONFIG,
      ...options.hot,
    };

    const tierPolicy: MemoryTierPolicy = {
      ...DEFAULT_TIER_POLICY,
      ...options.policy,
      warmSearchLimit: normalizePositiveInteger(
        options.policy?.warmSearchLimit ?? DEFAULT_TIER_POLICY.warmSearchLimit,
        "warmSearchLimit",
      ),
      coldSearchLimit: normalizePositiveInteger(
        options.policy?.coldSearchLimit ?? DEFAULT_TIER_POLICY.coldSearchLimit,
        "coldSearchLimit",
      ),
      retainHotMs: normalizeNonNegativeInteger(
        options.policy?.retainHotMs ?? DEFAULT_TIER_POLICY.retainHotMs,
        "retainHotMs",
      ),
    };

    this.appId = validateScopeId(options.appId ?? "default-app");
    const sessionId = validateScopeId(options.sessionId ?? "default-session");
    const userId = validateScopeId(options.userId ?? "default-user");

    const hotStore = new HotMemoryStore(hotConfig, options.now);
    const warmStore =
      options.warm === false ? undefined : (options.warm?.store ?? undefined);
    const coldStore =
      options.cold === false
        ? undefined
        : (options.cold?.store ??
          (options.cold?.archivePath
            ? ColdMemoryStore.fromConfig({
                ...DEFAULT_COLD_CONFIG,
                ...options.cold,
                archivePath: options.cold.archivePath,
                maxEntries:
                  options.cold.maxEntries ?? DEFAULT_COLD_CONFIG.maxEntries,
              })
            : undefined));

    this.memoryStore = new TieredMemoryStore(
      hotStore,
      warmStore,
      coldStore,
      tierPolicy,
    );

    this.session = new SessionScope(this.memoryStore, "session", sessionId);
    this.user = new UserScope(this.memoryStore, "user", userId);
    this.shared = new SharedScope(this.memoryStore, "shared", this.appId);
  }

  privateScope(agentId: string): PrivateScope {
    const normalizedAgentId = validateAgentId(agentId);
    return new PrivateScope(
      this.memoryStore,
      "private",
      `${this.appId}:${normalizedAgentId}`,
    );
  }

  searchAll(term: string, limit = 20): MemoryEntry[] {
    return this.memoryStore.search(term, { limit });
  }

  searchSession(term: string, sessionId: string, limit = 20): MemoryEntry[] {
    return this.memoryStore.search(term, {
      scope: "session",
      scopeId: validateScopeId(sessionId),
      limit,
    });
  }

  listAll(): MemoryEntry[] {
    return this.memoryStore.list();
  }

  clearAll(): void {
    this.memoryStore.clearAll();
  }
}
