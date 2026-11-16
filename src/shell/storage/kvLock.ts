/**
 * Serialisation for storage areas (review F3, N1, N2, N4).
 *
 * - withKeyLock(area, key, fn): read-modify-write on one key runs alone. Queues are
 *   keyed by the area's `name` (not the object), so two KvArea objects for the same
 *   backend share them. Different keys don't wait for each other.
 * - withAreaExclusive(area, fn): waits for every pending key lock on the area, blocks
 *   new ones until it finishes, and bumps the area's epoch before and after. Used by
 *   "Delete all data".
 * - Epoch: a key-locked operation remembers the epoch it was queued under. Its writes go
 *   through the LockedWriter it receives, which refuses (E_STORAGE_DELETED) if the
 *   epoch has moved on. So nothing queued before or during a deletion can write back
 *   afterwards, even if it was already in flight.
 *
 * RULE (N4): never request the same key again from inside its own fn (nested locking).
 * The nested call would wait for the outer one, which waits for the nested one: a
 * deadlock. JavaScript has no portable async-context API in a service worker, so a
 * nested call can't be told apart from an unrelated parallel caller reliably; the guard
 * is structural instead: inside the lock, writes go through the LockedWriter, which
 * only writes the locked key.
 */
import { StorageError } from "./idb";
import type { KvArea } from "./kv";

/** Writes to the locked key, refused once the area's epoch has changed. */
export interface LockedWriter {
  set(value: unknown): Promise<void>;
  remove(): Promise<void>;
}

type AreaState = {
  keys: Map<string, Promise<void>>;
  exclusive: Promise<void> | null;
  epoch: number;
};

const areas = new Map<string, AreaState>();

function stateOf(name: string): AreaState {
  let st = areas.get(name);
  if (st === undefined) {
    st = { keys: new Map(), exclusive: null, epoch: 0 };
    areas.set(name, st);
  }
  return st;
}

const settled = (p: Promise<unknown>): Promise<void> =>
  p.then(
    () => undefined,
    () => undefined,
  );

export const STORAGE_DELETED = "E_STORAGE_DELETED";

export function withKeyLock<T>(area: KvArea, key: string, run: (writer: LockedWriter) => Promise<T>): Promise<T> {
  const st = stateOf(area.name);
  const epoch = st.epoch;
  const current = (): void => {
    if (st.epoch !== epoch) throw new StorageError(STORAGE_DELETED);
  };
  const writer: LockedWriter = {
    set: async (value) => {
      current();
      await area.set(key, value);
    },
    remove: async () => {
      current();
      await area.remove(key);
    },
  };
  const previous = Promise.all([st.keys.get(key) ?? Promise.resolve(), st.exclusive ?? Promise.resolve()]);
  const start = (): Promise<T> => {
    current();
    return run(writer);
  };
  const result = previous.then(start, start);
  const tail = settled(result);
  st.keys.set(key, tail);
  void tail.then(() => {
    if (st.keys.get(key) === tail) st.keys.delete(key);
  });
  return result;
}

export function withAreaExclusive<T>(area: KvArea, run: () => Promise<T>): Promise<T> {
  const st = stateOf(area.name);
  // Everything queued so far is now stale: its writes are refused.
  st.epoch += 1;
  const waitFor = Promise.all([...st.keys.values(), st.exclusive ?? Promise.resolve()]);
  const start = (): Promise<T> => run();
  const result = waitFor.then(start, start).finally(() => {
    // Writes queued while we ran are stale too.
    st.epoch += 1;
  });
  const gate = settled(result);
  st.exclusive = gate;
  void gate.then(() => {
    if (st.exclusive === gate) st.exclusive = null;
  });
  return result;
}

/** True while some operation holds or waits for `key` on the area (for tests). */
export function isKeyLocked(area: KvArea, key: string): boolean {
  return areas.get(area.name)?.keys.has(key) ?? false;
}

/** The area's current epoch (for tests). */
export function areaEpoch(area: KvArea): number {
  return areas.get(area.name)?.epoch ?? 0;
}
