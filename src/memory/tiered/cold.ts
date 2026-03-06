import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  ColdTierConfig,
  MemoryEntry,
  MemorySearchOptions,
  MemoryTierStore,
  ScopeRecordInput,
  ScopeRecordKey,
} from "../types.js";

interface ArchivedMemoryDocument {
  readonly scope: ScopeRecordKey["scope"];
  readonly scopeId: string;
  readonly key: string;
  readonly value: unknown;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly accessCount: number;
  readonly lastAccessedAt: number;
  readonly id: string;
}

const normalizeText = (value: unknown): string => {
  if (typeof value === "string") {
    return value.toLowerCase();
  }

  return JSON.stringify(value).toLowerCase();
};

const compareByRecency = (left: MemoryEntry, right: MemoryEntry): number => {
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

const recordId = (key: ScopeRecordKey): string =>
  `${key.scope}:${key.scopeId}:${key.key}`;

const toColdEntry = <T>(document: ArchivedMemoryDocument): MemoryEntry<T> => {
  return {
    id: document.id,
    scope: document.scope,
    scopeId: document.scopeId,
    key: document.key,
    value: document.value as T,
    temperature: "cold",
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    accessCount: document.accessCount,
    lastAccessedAt: document.lastAccessedAt,
  };
};

const normalizeLimit = (limit: number | undefined): number => {
  const resolved = limit ?? 20;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error("search limit must be a positive integer");
  }

  return resolved;
};

export class ColdMemoryStore implements MemoryTierStore {
  private readonly recordsById = new Map<string, ArchivedMemoryDocument>();

  constructor(
    private readonly archivePath: string,
    private readonly maxEntries: number = 20000,
  ) {
    this.loadFromDisk();
  }

  static fromConfig(config: ColdTierConfig): ColdMemoryStore {
    return new ColdMemoryStore(config.archivePath, config.maxEntries);
  }

  upsert<T>(input: ScopeRecordInput<T>): MemoryEntry<T> {
    const now = Date.now();
    const key: ScopeRecordKey = {
      scope: input.scope,
      scopeId: input.scopeId,
      key: input.key,
    };
    const id = recordId(key);
    const previous = this.recordsById.get(id);

    const next: ArchivedMemoryDocument = {
      id: previous?.id ?? id,
      scope: key.scope,
      scopeId: key.scopeId,
      key: key.key,
      value: input.value,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      accessCount: previous?.accessCount ?? 0,
      lastAccessedAt: previous?.lastAccessedAt ?? now,
    };

    this.recordsById.set(id, next);
    this.enforceCapacity();
    this.persist();
    return toColdEntry<T>(next);
  }

  get<T>(key: ScopeRecordKey): MemoryEntry<T> | undefined {
    const id = recordId(key);
    const existing = this.recordsById.get(id);
    if (!existing) {
      return undefined;
    }

    const touched: ArchivedMemoryDocument = {
      ...existing,
      accessCount: existing.accessCount + 1,
      lastAccessedAt: Date.now(),
    };
    this.recordsById.set(id, touched);
    this.persist();

    return toColdEntry<T>(touched);
  }

  delete(key: ScopeRecordKey): boolean {
    const deleted = this.recordsById.delete(recordId(key));
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  clearScope(scope: ScopeRecordKey["scope"], scopeId: string): number {
    let removed = 0;
    for (const [id, record] of this.recordsById.entries()) {
      if (record.scope === scope && record.scopeId === scopeId) {
        this.recordsById.delete(id);
        removed += 1;
      }
    }

    if (removed > 0) {
      this.persist();
    }
    return removed;
  }

  list(scope?: ScopeRecordKey["scope"], scopeId?: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];

    for (const record of this.recordsById.values()) {
      if (scope && record.scope !== scope) {
        continue;
      }
      if (scopeId && record.scopeId !== scopeId) {
        continue;
      }

      entries.push(toColdEntry(record));
    }

    return entries.sort(compareByRecency);
  }

  search(term: string, options: MemorySearchOptions = {}): MemoryEntry[] {
    const limit = normalizeLimit(options.limit);
    const normalizedTerm = term.trim().toLowerCase();
    if (normalizedTerm.length === 0) {
      return [];
    }

    const matches: MemoryEntry[] = [];
    for (const record of this.recordsById.values()) {
      if (options.scope && record.scope !== options.scope) {
        continue;
      }
      if (options.scopeId && record.scopeId !== options.scopeId) {
        continue;
      }

      const inKey = record.key.toLowerCase().includes(normalizedTerm);
      const inValue = normalizeText(record.value).includes(normalizedTerm);
      if (!inKey && !inValue) {
        continue;
      }

      matches.push(toColdEntry(record));
    }

    return matches.sort(compareByRecency).slice(0, limit);
  }

  clearAll(): void {
    if (this.recordsById.size === 0) {
      return;
    }

    this.recordsById.clear();
    this.persist();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.archivePath)) {
      return;
    }

    const raw = readFileSync(this.archivePath, "utf8");
    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      const parsed = JSON.parse(trimmed) as ArchivedMemoryDocument;
      const key: ScopeRecordKey = {
        scope: parsed.scope,
        scopeId: parsed.scopeId,
        key: parsed.key,
      };
      this.recordsById.set(recordId(key), parsed);
    }
  }

  private persist(): void {
    const parent = dirname(this.archivePath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }

    const lines = [...this.recordsById.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => JSON.stringify(record));
    writeFileSync(
      this.archivePath,
      `${lines.join("\n")}${lines.length ? "\n" : ""}`,
      "utf8",
    );
  }

  private enforceCapacity(): void {
    if (this.recordsById.size <= this.maxEntries) {
      return;
    }

    const overflow = this.recordsById.size - this.maxEntries;
    const sorted = [...this.recordsById.values()].sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return left.updatedAt - right.updatedAt;
      }

      return left.id.localeCompare(right.id);
    });

    for (const record of sorted.slice(0, overflow)) {
      this.recordsById.delete(record.id);
    }
  }
}
