/**
 * Storage start-up (DATA_MODEL §8), in this order:
 *   1. storage.local migrations;
 *   2. open IndexedDB `fb` (upgrade in onupgradeneeded);
 *   3. raw purge: if there is no valid session.active, clear `segments` (else delete
 *      other sessions' segments). Runs even
 *      if 1–2 failed, then through a version-less open, and only if the store exists;
 *   4. retention pruning with prefs.retentionDays (normal mode only); repaired
 *      prefs are written back first (normal mode only, §8.1).
 * Safe mode = a migration or the IndexedDB open failed.
 */
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, runMigrations, type Migration } from "../../core/storage/migrations";
import { cutoff } from "../../core/storage/retention";
import { trySnapshot } from "../../core/storage/snapshot";
import { isPlainObject, validateMeta } from "../../core/storage/validate";
import { errorCode, type KeyRangeApi, openFb, openFbExisting, runTx, STORE_SEGMENTS } from "./idb";
import {
  interventionsRepo,
  type InterventionsRepo,
  SEGMENT_CAP,
  segmentsRepo,
  type SegmentsRepo,
  sessionsRepo,
  type SessionsRepo,
} from "./idbRepos";
import type { KvArea } from "./kv";
import {
  activeRepo,
  type ActiveRepo,
  diagRepo,
  type DiagRepo,
  diagSink,
  KEY_META,
  LOCAL_KEYS,
  metaRepo,
  type MetaRepo,
  overridesRepo,
  type OverridesRepo,
  prefsRepo,
  type PrefsRepo,
} from "./kvRepos";

/** UiSnapshot notice codes this layer raises (API_CONTRACTS §6). */
export type StorageNoticeCode = "safe_mode" | "prefs_reset" | "storage_error";
export type StorageNotice = { code: StorageNoticeCode; at: number };

export type StorageRepos = {
  prefs: PrefsRepo;
  overrides: OverridesRepo;
  active: ActiveRepo;
  meta: MetaRepo;
  diag: DiagRepo;
  /** null when IndexedDB couldn't be opened (safe mode). */
  segments: SegmentsRepo | null;
  interventions: InterventionsRepo | null;
  sessions: SessionsRepo | null;
};

export type OpenStorageResult = {
  mode: "normal" | "safe";
  notices: StorageNotice[];
  repos: StorageRepos;
  /** Closes the IndexedDB connection (pass to deleteAllStorage's closeFns). */
  close: () => void;
};

export type OpenStorageOptions = {
  local: KvArea;
  /** storage.session; not read at start-up (the UI snapshot is the engine's, Day 07). */
  session: KvArea;
  idbFactory: IDBFactory;
  now: () => number;
  /** Defaults to the global IDBKeyRange (Node tests pass fake-indexeddb's). */
  idbKeyRange?: KeyRangeApi;
  /** Defaults to MIGRATIONS; tests inject fixture migrations. */
  migrations?: readonly Migration[];
  /** Defaults to SEGMENT_CAP (5,000); tests inject a small cap. */
  segmentCap?: number;
};

/**
 * The stored schema version (DATA_MODEL §8.1, review F10):
 * - no meta, or meta without schemaVersion → "missing" (treated as schema 1);
 * - meta that isn't a plain object, or a schemaVersion that isn't a non-negative
 *   integer → "invalid" (safe mode). A version newer than the code fails in runMigrations.
 */
function storedVersion(raw: unknown): number | "missing" | "invalid" {
  if (raw === undefined) return "missing";
  const snap = trySnapshot(raw);
  if (!snap.ok || !isPlainObject(snap.value)) return "invalid";
  const v = snap.value.schemaVersion;
  if (v === undefined) return "missing";
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : "invalid";
}

/** Step 1. `failed` non-empty means safe mode; `notes` are diag codes for repairs. */
async function migrateLocal(
  local: KvArea,
  now: () => number,
  migrations: readonly Migration[],
): Promise<{ failed: string[]; notes: string[] }> {
  const data: Record<string, unknown> = {};
  for (const key of LOCAL_KEYS) {
    const value = await local.get(key);
    if (value !== undefined) data[key] = value;
  }
  const rawMeta = data[KEY_META];
  const version = storedVersion(rawMeta);
  if (version === "invalid") return { failed: ["E_META_INVALID"], notes: [] };
  if (version === "missing") {
    // No meta (first run) or no schemaVersion: schema 1 is the only schema ever written.
    await local.set(KEY_META, { schemaVersion: CURRENT_SCHEMA_VERSION, installedAt: now() });
    return { failed: [], notes: rawMeta === undefined ? [] : ["E_META_REPAIRED"] };
  }
  const result = runMigrations(data, version, migrations);
  if (!result.ok) return { failed: result.errors, notes: [] };
  if (result.applied === 0) {
    // Current schema: repair any other invalid field (installedAt = now).
    if (validateMeta(rawMeta).ok) return { failed: [], notes: [] };
    await local.set(KEY_META, { schemaVersion: result.version, installedAt: now() });
    return { failed: [], notes: ["E_META_REPAIRED"] };
  }
  const oldInstalled = isPlainObject(rawMeta) ? rawMeta.installedAt : undefined;
  const installedAt =
    typeof oldInstalled === "number" && Number.isFinite(oldInstalled) && oldInstalled >= 0 ? oldInstalled : now();
  // Data keys first, meta last: a crash in between re-runs the (idempotent) steps.
  for (const key of LOCAL_KEYS) {
    if (key === KEY_META) continue;
    const value = result.data[key];
    if (value === undefined) await local.remove(key);
    else await local.set(key, value);
  }
  await local.set(KEY_META, { schemaVersion: result.version, installedAt });
  return { failed: [], notes: [] };
}

/**
 * Step 3 with an open connection. No session → clear the store. A valid session →
 * delete every other session's segments (review F9): keys are [sessionId, seq], so
 * everything below [id] and above [id, []] (arrays sort after numbers) belongs to others.
 */
function purgeSegments(db: IDBDatabase, keepSessionId: string | null, keyRange: KeyRangeApi): Promise<void> {
  return runTx(db, STORE_SEGMENTS, "readwrite", (tx) => {
    const store = tx.objectStore(STORE_SEGMENTS);
    if (keepSessionId === null) store.clear();
    else {
      store.delete(keyRange.upperBound([keepSessionId], true));
      store.delete(keyRange.lowerBound([keepSessionId, []], true));
    }
    return () => undefined;
  });
}

/** Step 3 without a versioned connection: version-less open, and only if `segments` exists. */
async function purgeWithoutVersion(
  factory: IDBFactory,
  keepSessionId: string | null,
  keyRange: KeyRangeApi,
): Promise<void> {
  const db = await openFbExisting(factory);
  if (db === null) return;
  try {
    if (db.objectStoreNames.contains(STORE_SEGMENTS)) await purgeSegments(db, keepSessionId, keyRange);
  } finally {
    db.close();
  }
}

export async function openStorage(options: OpenStorageOptions): Promise<OpenStorageResult> {
  const { local, idbFactory, now } = options;
  const keyRange = options.idbKeyRange ?? IDBKeyRange;
  const migrations = options.migrations ?? MIGRATIONS;
  const codes: string[] = [];
  let safe = false;
  let storageError = false;

  const diag = diagRepo(local, now);
  const onInvalid = diagSink(diag);

  // 1. storage.local migrations.
  try {
    const { failed, notes } = await migrateLocal(local, now, migrations);
    codes.push(...notes);
    if (failed.length > 0) {
      safe = true;
      codes.push(...failed);
    }
  } catch (error) {
    safe = true;
    codes.push(errorCode(error, "E_MIGRATION_LOCAL_IO"));
  }

  // 2. Open IndexedDB.
  let db: IDBDatabase | null = null;
  try {
    db = await openFb(idbFactory);
  } catch (error) {
    safe = true;
    codes.push(errorCode(error, "E_IDB_OPEN"));
  }

  const active = activeRepo(local);

  // 3. Raw purge: no valid session.active ⇒ no segments (invariant 3); a valid one ⇒
  // only its own segments. A read failure counts as "no valid session": raw data
  // must never outlive one.
  try {
    let keep: string | null = null;
    try {
      const read = await active.get();
      if ("state" in read) keep = read.state.session.id;
    } catch {
      codes.push("E_ACTIVE_READ");
    }
    if (db !== null) await purgeSegments(db, keep, keyRange);
    else await purgeWithoutVersion(idbFactory, keep, keyRange);
  } catch (error) {
    storageError = true;
    codes.push(errorCode(error, "E_RAW_PURGE"));
  }

  const prefs = prefsRepo(local);
  const notices: StorageNotice[] = [];
  const at = now();

  // 4. Retention pruning (normal mode only: safe mode keeps aggregates).
  let resetFields: string[] = [];
  try {
    const read = await prefs.get();
    resetFields = read.resetFields;
    // DATA_MODEL §8.1: repaired prefs are written back (normal mode only), so the
    // prefs_reset notice appears once, not on every start.
    if (!safe && resetFields.length > 0) {
      const written = await prefs.put(read.prefs);
      if (!written.ok) codes.push("E_PREFS_REPAIR_INVALID");
    }
    if (!safe && db !== null) {
      const deps = { db, keyRange, onInvalid };
      await sessionsRepo(deps).pruneOlderThan(cutoff(at, read.prefs.retentionDays));
    }
  } catch (error) {
    storageError = true;
    codes.push(errorCode(error, "E_RETENTION_PRUNE"));
  }

  if (safe) notices.push({ code: "safe_mode", at });
  if (storageError) notices.push({ code: "storage_error", at });
  if (!safe && resetFields.length > 0) notices.push({ code: "prefs_reset", at });
  if (resetFields.length > 0) codes.push("E_PREFS_RESET");

  try {
    await diag.appendMany(codes);
  } catch {
    // Diag is best effort.
  }

  const openDb = db;
  const deps = openDb === null ? null : { db: openDb, keyRange, onInvalid };
  return {
    mode: safe ? "safe" : "normal",
    notices,
    repos: {
      prefs,
      overrides: overridesRepo(local, onInvalid),
      active,
      meta: metaRepo(local),
      diag,
      segments: deps === null ? null : segmentsRepo(deps, options.segmentCap ?? SEGMENT_CAP),
      interventions: deps === null ? null : interventionsRepo(deps),
      sessions: deps === null ? null : sessionsRepo(deps),
    },
    close: () => openDb?.close(),
  };
}
