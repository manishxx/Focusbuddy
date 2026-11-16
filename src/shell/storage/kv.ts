/**
 * Key-value area interface (DATA_MODEL §8), implemented by chrome.storage.local /
 * .session and, in tests, by memoryKv. Chrome APIs are called directly inside
 * explicit wrappers (lint rule fb/chrome-access), never aliased.
 */
export interface KvArea {
  /** The stored value, or undefined when the key is absent. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** chrome.storage.local (never .sync: SECURITY §3). */
export function chromeLocalArea(): KvArea {
  return {
    get: async (key) => {
      const items: Record<string, unknown> = await chrome.storage.local.get(key);
      return items[key];
    },
    set: (key, value) => chrome.storage.local.set({ [key]: value }),
    remove: (key) => chrome.storage.local.remove(key),
    clear: () => chrome.storage.local.clear(),
  };
}

/** chrome.storage.session (trusted contexts only by default). */
export function chromeSessionArea(): KvArea {
  return {
    get: async (key) => {
      const items: Record<string, unknown> = await chrome.storage.session.get(key);
      return items[key];
    },
    set: (key, value) => chrome.storage.session.set({ [key]: value }),
    remove: (key) => chrome.storage.session.remove(key),
    clear: () => chrome.storage.session.clear(),
  };
}
