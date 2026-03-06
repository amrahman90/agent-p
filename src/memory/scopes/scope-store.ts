import { randomUUID } from "node:crypto";

import type { MemoryEntry, MemoryTierStore } from "../types.js";
import { validateMemoryKey, validateScopeId } from "../validation.js";

import type { MemoryScope } from "../types.js";

export class ScopeStore {
  private readonly normalizedScopeId: string;

  constructor(
    private readonly memoryStore: MemoryTierStore,
    private readonly scope: MemoryScope,
    scopeId: string,
  ) {
    this.normalizedScopeId = validateScopeId(scopeId);
  }

  set<T>(key: string, value: T): MemoryEntry<T> {
    const normalizedKey = validateMemoryKey(key);

    return this.memoryStore.upsert({
      scope: this.scope,
      scopeId: this.normalizedScopeId,
      key: normalizedKey,
      value,
    });
  }

  save<T>(key: string, value: T): MemoryEntry<T> {
    return this.set(key, value);
  }

  add<T>(value: T, key: string = randomUUID()): MemoryEntry<T> {
    return this.set(key, value);
  }

  get<T>(key: string): MemoryEntry<T> | undefined {
    const normalizedKey = validateMemoryKey(key);

    return this.memoryStore.get<T>({
      scope: this.scope,
      scopeId: this.normalizedScopeId,
      key: normalizedKey,
    });
  }

  load<T>(key: string): MemoryEntry<T> | undefined {
    return this.get(key);
  }

  delete(key: string): boolean {
    const normalizedKey = validateMemoryKey(key);

    return this.memoryStore.delete({
      scope: this.scope,
      scopeId: this.normalizedScopeId,
      key: normalizedKey,
    });
  }

  list(): MemoryEntry[] {
    return this.memoryStore.list(this.scope, this.normalizedScopeId);
  }

  search(term: string, limit = 20): MemoryEntry[] {
    return this.memoryStore.search(term, {
      scope: this.scope,
      scopeId: this.normalizedScopeId,
      limit,
    });
  }

  clear(): number {
    return this.memoryStore.clearScope(this.scope, this.normalizedScopeId);
  }
}
