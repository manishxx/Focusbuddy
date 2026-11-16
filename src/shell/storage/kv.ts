/**
 * Key-value area interface (DATA_MODEL §8), implemented by chrome.storage.local /
 * .session and, in tests, by memoryKv. Chrome APIs are called directly inside
 * explicit wrappers (lint rule fb/chrome-access), never aliased.
 */
export interface KvArea {
  /**
   * Identifies the backend. Locks and deletion epochs (kvLock.ts) are keyed by it, so
   * every KvArea object for the same backend must use the same name (review N2).
   */
  readonly name: string;
  /** The stored value, or undefined when the key is absent. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export const CHROME_LOCAL_NAME = "chrome.storage.local";
export const CHROME_SESSION_NAME = "chrome.storage.session";

// Module-level singletons: one object per backend (review N2). Creating them calls no
// chrome API; `chrome` is only read when a method runs.
const LOCAL: KvArea = {
  name: CHROME_LOCAL_NAME,
  get: async (key) => {
    const items: Record<string, unknown> = await chrome.storage.local.get(key);
    return items[key];
  },
  set: (key, value) => chrome.storage.local.set({ [key]: value }),
  remove: (key) => chrome.storage.local.remove(key),
  clear: () => chrome.storage.local.clear(),
};

const SESSION: KvArea = {
  name: CHROME_SESSION_NAME,
  get: async (key) => {
    const items: Record<string, unknown> = await chrome.storage.session.get(key);
    return items[key];
  },
  set: (key, value) => chrome.storage.session.set({ [key]: value }),
  remove: (key) => chrome.storage.session.remove(key),
  clear: () => chrome.storage.session.clear(),
};

/** chrome.storage.local (never .sync: SECURITY §3). Always the same object. */
export function chromeLocalArea(): KvArea {
  return LOCAL;
}

/** chrome.storage.session (trusted contexts only by default). Always the same object. */
export function chromeSessionArea(): KvArea {
  return SESSION;
}
