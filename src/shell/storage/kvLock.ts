/**
 * Per-key promise queue (review F3). Every read-modify-write on a KvArea key runs
 * through withKeyLock, keyed by (area object, key), so parallel calls from any
 * repository on the same area are serialised and no update is lost. Different
 * keys, or different areas, don't wait for each other.
 */
import type { KvArea } from "./kv";

const queues = new WeakMap<KvArea, Map<string, Promise<void>>>();

export function withKeyLock<T>(area: KvArea, key: string, run: () => Promise<T>): Promise<T> {
  let byKey = queues.get(area);
  if (byKey === undefined) {
    byKey = new Map();
    queues.set(area, byKey);
  }
  const map = byKey;
  const previous = map.get(key) ?? Promise.resolve();
  // Run after the previous holder settles, whether it succeeded or not.
  const result = previous.then(run, run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  map.set(key, tail);
  void tail.then(() => {
    if (map.get(key) === tail) map.delete(key);
  });
  return result;
}

/** True while some operation holds or waits for `key` on `area` (for tests). */
export function isKeyLocked(area: KvArea, key: string): boolean {
  return queues.get(area)?.has(key) ?? false;
}
