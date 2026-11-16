/**
 * Repositories over storage.local (DATA_MODEL §1, §8). Every write is validated
 * strictly; every read is validated, and invalid data never reaches the caller.
 * The SW is the single writer (ADR-0001), so there is no locking.
 */
import { appendDiag } from "../../core/storage/diag";
import { defaultPreferences } from "../../core/storage/defaults";
import {
  isPlainObject,
  parsePreferences,
  validateActiveState,
  validateDiagEntry,
  validateMeta,
  validateOverride,
  validatePreferences,
} from "../../core/storage/validate";
import type { ActiveState, DiagEntry, Meta, Override, Preferences } from "../../core/types";
import { LIMITS } from "../../core/storage/validate";
import { trySnapshot } from "../../core/storage/snapshot";
import type { KvArea } from "./kv";
import { withKeyLock } from "./kvLock";

export const KEY_PREFS = "prefs";
export const KEY_OVERRIDES = "overrides.global";
export const KEY_ACTIVE = "session.active";
export const KEY_META = "meta";
export const KEY_DIAG = "diag.log";
/** All storage.local keys this layer owns (the migration input). */
export const LOCAL_KEYS = [KEY_PREFS, KEY_OVERRIDES, KEY_ACTIVE, KEY_META, KEY_DIAG] as const;

export type WriteResult = { ok: true } | { ok: false; errors: string[] };

/** Records invalid rows that were skipped on read: `count` diag entries with `code`. */
export type InvalidSink = (code: string, count: number) => Promise<void>;

// ---- diag ----

export interface DiagRepo {
  list(): Promise<DiagEntry[]>;
  append(code: string): Promise<void>;
  appendMany(codes: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

export function diagRepo(local: KvArea, now: () => number): DiagRepo {
  const list = async (): Promise<DiagEntry[]> => {
    const raw = await local.get(KEY_DIAG);
    if (!Array.isArray(raw)) return [];
    const items: unknown[] = raw;
    const out: DiagEntry[] = [];
    for (const item of items) {
      const r = validateDiagEntry(item);
      if (r.ok) out.push(r.value);
    }
    return out;
  };
  const appendMany = async (codes: readonly string[]): Promise<void> => {
    if (codes.length === 0) return;
    await withKeyLock(local, KEY_DIAG, async () => {
      let log = await list();
      const at = now();
      for (const code of codes) log = appendDiag(log, { at, code });
      await local.set(KEY_DIAG, log);
    });
  };
  return {
    list,
    append: (code) => appendMany([code]),
    appendMany,
    clear: () => withKeyLock(local, KEY_DIAG, () => local.remove(KEY_DIAG)),
  };
}

/** An InvalidSink that writes to the diag log and never throws. */
export function diagSink(diag: DiagRepo): InvalidSink {
  return async (code, count) => {
    if (count <= 0) return;
    try {
      await diag.appendMany(Array.from({ length: count }, () => code));
    } catch {
      // The diag log is best effort; the row was skipped either way.
    }
  };
}

// ---- prefs ----

export interface PrefsRepo {
  /** Per-field fallback read (AC-15). */
  get(): Promise<{ prefs: Preferences; resetFields: string[] }>;
  /** Merges `patch` over the current prefs (top-level fields) and writes the result if valid. */
  update(patch: unknown): Promise<WriteResult & { prefs?: Preferences }>;
  /** Writes a complete, valid Preferences value. */
  put(prefs: unknown): Promise<WriteResult>;
  /** Writes the defaults. */
  reset(): Promise<Preferences>;
}

export function prefsRepo(local: KvArea): PrefsRepo {
  const get = async (): Promise<{ prefs: Preferences; resetFields: string[] }> =>
    parsePreferences(await local.get(KEY_PREFS));
  const put = (prefs: unknown): Promise<WriteResult> =>
    withKeyLock(local, KEY_PREFS, async () => {
      const r = validatePreferences(prefs);
      if (!r.ok) return r;
      await local.set(KEY_PREFS, r.value);
      return { ok: true };
    });
  return {
    get,
    put,
    update(patch) {
      // Read the patch once (review F1), then read-modify-write under the key lock (F3).
      const snap = trySnapshot(patch);
      if (!snap.ok) return Promise.resolve({ ok: false, errors: ["patch:not_cloneable"] });
      const data = snap.value;
      if (!isPlainObject(data)) return Promise.resolve({ ok: false, errors: ["patch:not_object"] });
      return withKeyLock(local, KEY_PREFS, async () => {
        const { prefs } = await get();
        const r = validatePreferences({ ...prefs, ...data });
        if (!r.ok) return r;
        await local.set(KEY_PREFS, r.value);
        return { ok: true, prefs: r.value };
      });
    },
    reset: () =>
      withKeyLock(local, KEY_PREFS, async () => {
        const prefs = defaultPreferences();
        await local.set(KEY_PREFS, prefs);
        return prefs;
      }),
  };
}

// ---- overrides ----

export interface OverridesRepo {
  list(): Promise<Override[]>;
  /** Adds unless an override with the same host and titleSubstring exists. */
  add(override: unknown): Promise<WriteResult & { added?: boolean }>;
  /** Removes overrides matching host (and titleSubstring, when given). Returns how many. */
  remove(host: string, titleSubstring?: string): Promise<number>;
}

const sameOverride = (a: Override, b: Override): boolean => a.host === b.host && a.titleSubstring === b.titleSubstring;

export function overridesRepo(local: KvArea, onInvalid: InvalidSink): OverridesRepo {
  const list = async (): Promise<Override[]> => {
    const raw = await local.get(KEY_OVERRIDES);
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      await onInvalid("E_INVALID_OVERRIDES", 1);
      return [];
    }
    const items: unknown[] = raw;
    const out: Override[] = [];
    let invalid = 0;
    for (const item of items) {
      const r = validateOverride(item);
      if (r.ok && !out.some((o) => sameOverride(o, r.value))) out.push(r.value);
      else if (!r.ok) invalid += 1;
    }
    await onInvalid("E_INVALID_OVERRIDE_ROW", invalid);
    if (out.length > LIMITS.overridesGlobal) {
      // DATA_MODEL §8.1: at most 200. Keep the oldest 200, as add() would have.
      await onInvalid("E_OVERRIDES_OVER_CAP", 1);
      return out.slice(0, LIMITS.overridesGlobal);
    }
    return out;
  };
  return {
    list,
    async add(override) {
      const r = validateOverride(override);
      if (!r.ok) return r;
      return withKeyLock(local, KEY_OVERRIDES, async () => {
        const current = await list();
        if (current.some((o) => sameOverride(o, r.value))) return { ok: true, added: false };
        if (current.length >= LIMITS.overridesGlobal) return { ok: false, errors: ["overrides:too_many"] };
        await local.set(KEY_OVERRIDES, [...current, r.value]);
        return { ok: true, added: true };
      });
    },
    remove(host, titleSubstring) {
      return withKeyLock(local, KEY_OVERRIDES, async () => {
        const current = await list();
        const keep = current.filter(
          (o) => !(o.host === host && (titleSubstring === undefined || o.titleSubstring === titleSubstring)),
        );
        await local.set(KEY_OVERRIDES, keep);
        return current.length - keep.length;
      });
    },
  };
}

// ---- active session ----

export type ActiveRead = { state: ActiveState } | { none: true } | { corrupt: true };

export interface ActiveRepo {
  /** `{corrupt}`: the engine ends the session with stale_pause and no summary (Day 07). */
  get(): Promise<ActiveRead>;
  put(state: unknown): Promise<WriteResult>;
  remove(): Promise<void>;
}

export function activeRepo(local: KvArea): ActiveRepo {
  return {
    async get() {
      const raw = await local.get(KEY_ACTIVE);
      if (raw === undefined) return { none: true };
      const r = validateActiveState(raw);
      return r.ok ? { state: r.value } : { corrupt: true };
    },
    async put(state) {
      const r = validateActiveState(state);
      if (!r.ok) return r;
      await withKeyLock(local, KEY_ACTIVE, () => local.set(KEY_ACTIVE, r.value));
      return { ok: true };
    },
    remove: () => withKeyLock(local, KEY_ACTIVE, () => local.remove(KEY_ACTIVE)),
  };
}

// ---- meta ----

export interface MetaRepo {
  /** null when absent or invalid. */
  get(): Promise<Meta | null>;
  put(meta: unknown): Promise<WriteResult>;
}

export function metaRepo(local: KvArea): MetaRepo {
  return {
    async get() {
      const r = validateMeta(await local.get(KEY_META));
      return r.ok ? r.value : null;
    },
    async put(meta) {
      const r = validateMeta(meta);
      if (!r.ok) return r;
      await withKeyLock(local, KEY_META, () => local.set(KEY_META, r.value));
      return { ok: true };
    },
  };
}
