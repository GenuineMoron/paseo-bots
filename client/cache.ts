import { readItem, readItemSync, writeItem } from "./storage";

/**
 * A small persisted cache for data that is cheap to show at once and refetch behind:
 * the bots' chat lists. One storage key holds every entry, newest first, bounded by
 * count and size so it can never grow without limit. Reads are served from memory; the
 * stored copy is loaded once, synchronously on the web and desktop, from AsyncStorage on
 * phones (`ready` resolves when it has). Everything is best effort, like `storage.ts`.
 */
export interface PersistedCache<T> {
  /** Resolves once the stored entries are in memory. */
  readonly ready: Promise<void>;
  get(id: string): T | undefined;
  set(id: string, value: T): void;
  delete(id: string): void;
}

export interface PersistedCacheOptions {
  /** Storage key; bump the version in it when the stored shape changes. */
  key: string;
  maxEntries: number;
  /** Serialized size above which the oldest entries are dropped. */
  maxBytes: number;
  /** Wait after the last change before writing. */
  writeDelayMs?: number;
}

interface Stored<T> {
  at: number;
  value: T;
}

function parse<T>(raw: string | null): Map<string, Stored<T>> {
  const map = new Map<string, Stored<T>>();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return map;
    for (const item of parsed) {
      if (!Array.isArray(item) || typeof item[0] !== "string" || typeof item[1] !== "number") continue;
      map.set(item[0], { at: item[1], value: item[2] as T });
    }
  } catch {
    // A corrupt copy is the same as no copy.
  }
  return map;
}

export function createPersistedCache<T>({ key, maxEntries, maxBytes, writeDelayMs = 1500 }: PersistedCacheOptions): PersistedCache<T> {
  let entries = parse<T>(readItemSync(key));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const serialize = (): string => {
    const newest = [...entries.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, maxEntries);
    let raw = JSON.stringify(newest.map(([id, item]) => [id, item.at, item.value]));
    while (raw.length > maxBytes && newest.length > 1) {
      newest.pop();
      raw = JSON.stringify(newest.map(([id, item]) => [id, item.at, item.value]));
    }
    entries = new Map(newest);
    return raw;
  };

  const schedule = () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      try {
        void writeItem(key, serialize());
      } catch {
        // A value that can't be serialized just isn't persisted.
      }
    }, writeDelayMs);
  };

  const ready = readItem(key).then((raw) => {
    // Whatever was set while the stored copy loaded is newer than it.
    const stored = parse<T>(raw);
    for (const [id, item] of stored) if (!entries.has(id)) entries.set(id, item);
  });

  return {
    ready,
    get: (id) => entries.get(id)?.value,
    set: (id, value) => {
      entries.set(id, { at: Date.now(), value });
      schedule();
    },
    delete: (id) => {
      if (entries.delete(id)) schedule();
    },
  };
}
