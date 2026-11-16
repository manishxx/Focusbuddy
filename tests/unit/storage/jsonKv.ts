// A KvArea that JSON round-trips every value, like chrome.storage does: holes become
// null, undefined object fields vanish, non-JSON values are dropped.
import type { KvArea } from "../../../src/shell/storage/kv";

export interface JsonKv extends KvArea {
  /** The raw JSON text stored under `key` (for assertions). */
  raw(key: string): string | undefined;
}

export function jsonKv(initial: Record<string, unknown> = {}): JsonKv {
  const data = new Map<string, string>();
  for (const [k, v] of Object.entries(initial)) data.set(k, JSON.stringify(v));
  const read = (key: string): unknown => {
    const text = data.get(key);
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  };
  return {
    get: (key) => Promise.resolve(read(key)),
    set: (key, value) => {
      const text = JSON.stringify(value);
      if (text === undefined) data.delete(key);
      else data.set(key, text);
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
    raw: (key) => data.get(key),
  };
}
