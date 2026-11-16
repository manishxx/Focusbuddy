/**
 * Pure migration runner for the storage.local schema (DATA_MODEL §5). The
 * IndexedDB schema is migrated separately, in onupgradeneeded (shell/storage/idb.ts).
 *
 * Each step is a pure function `(old) → new`. Steps must be idempotent: a step
 * checks the shape it is given before acting, so re-running it after a crash
 * between the two backends' migrations changes nothing.
 */

/** The storage.local schema version this build writes (meta.schemaVersion). */
export const CURRENT_SCHEMA_VERSION = 1;

/** storage.local contents keyed by storage key; absent keys are simply missing. */
export type LocalData = Readonly<Record<string, unknown>>;

export type Migration = {
  readonly from: number;
  readonly to: number;
  readonly migrate: (data: LocalData) => LocalData;
};

/** Schema 1 is the first shipped schema, so there is nothing to migrate yet. */
export const MIGRATIONS: readonly Migration[] = [];

export type MigrationResult =
  { ok: true; data: LocalData; version: number; applied: number } | { ok: false; errors: string[] };

/**
 * Applies the steps of `list` in order from `fromVersion` up to `target`.
 * On any failure it returns only error codes, never partially migrated data.
 */
export function runMigrations(
  data: LocalData,
  fromVersion: number,
  list: readonly Migration[] = MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): MigrationResult {
  if (!Number.isInteger(fromVersion) || fromVersion < 0) return { ok: false, errors: ["E_MIGRATION_BAD_VERSION"] };
  if (fromVersion > target) return { ok: false, errors: ["E_SCHEMA_NEWER_THAN_BUILD"] };
  for (const step of list) {
    if (!Number.isInteger(step.from) || !Number.isInteger(step.to) || step.to <= step.from) {
      return { ok: false, errors: ["E_MIGRATION_BAD_STEP"] };
    }
  }
  let current = data;
  let version = fromVersion;
  let applied = 0;
  while (version < target) {
    const step = list.find((s) => s.from === version);
    if (step === undefined || step.to > target) return { ok: false, errors: ["E_MIGRATION_NO_PATH"] };
    try {
      current = step.migrate(current);
    } catch {
      return { ok: false, errors: [`E_MIGRATION_FAILED_${step.from}_${step.to}`] };
    }
    version = step.to;
    applied += 1;
  }
  return { ok: true, data: current, version, applied };
}
