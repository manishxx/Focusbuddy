/**
 * In-memory KvArea for tests. Values are structured-cloned on set and on get, as
 * chrome.storage serialises them, so callers can't mutate stored state by reference.
 */
import type { KvArea } from "./kv";

export interface MemoryKv extends KvArea {
  /** Stored keys, for assertions. */
  keys(): string[];
}

export function memoryKv(initial: Record<string, unknown> = {}): MemoryKv {
  const data = new Map<string, unknown>();
  for (const [k, v] of Object.entries(initial)) data.set(k, structuredClone(v));
  return {
    get: (key) => Promise.resolve(data.has(key) ? structuredClone(data.get(key)) : undefined),
    set: (key, value) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      data.clear();
      return Promise.resolve();
    },
    keys: () => [...data.keys()],
  };
}
