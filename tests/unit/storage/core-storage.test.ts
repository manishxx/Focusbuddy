// parsePreferences (AC-15), migrations, diag log and retention (DATA_MODEL §5, §8).
import { describe, expect, it } from "vitest";
import { defaultPreferences } from "../../../src/core/storage/defaults";
import { appendDiag, DIAG_CAP, INVALID_DIAG_CODE, normaliseDiagEntry } from "../../../src/core/storage/diag";
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
  type LocalData,
  type Migration,
} from "../../../src/core/storage/migrations";
import { cutoff, DAY_MS, isExpired } from "../../../src/core/storage/retention";
import { parsePreferences, PREF_KEYS } from "../../../src/core/storage/validate";

describe("parsePreferences: per-field fallback (AC-15)", () => {
  it("nothing stored → defaults, no resets", () => {
    expect(parsePreferences(undefined)).toEqual({ prefs: defaultPreferences(), resetFields: [] });
  });

  it("valid prefs → unchanged, no resets", () => {
    const p = { ...defaultPreferences(), retentionDays: 7, defaultMode: "strict" };
    expect(parsePreferences(p)).toEqual({ prefs: p, resetFields: [] });
  });

  it("invalid fields fall back individually; valid ones are kept", () => {
    const stored = {
      ...defaultPreferences(),
      driftThresholdSec: 5,
      maxPerHour: 99,
      retentionDays: 14,
      sound: { enabled: true, tone: "laser", volume: 0.2 },
      defaultMode: "adaptive",
    };
    const { prefs, resetFields } = parsePreferences(stored);
    expect(resetFields.sort()).toEqual(["driftThresholdSec", "maxPerHour", "sound"]);
    expect(prefs.driftThresholdSec).toBe(90);
    expect(prefs.maxPerHour).toBe(4);
    expect(prefs.sound).toEqual(defaultPreferences().sound);
    expect(prefs.retentionDays).toBe(14);
    expect(prefs.defaultMode).toBe("adaptive");
  });

  it("missing fields are defaulted and reported; unknown fields are dropped and reported", () => {
    const stored: Record<string, unknown> = { ...defaultPreferences(), legacyFlag: true, "bad key!": 1 };
    delete stored.overlay;
    const { prefs, resetFields } = parsePreferences(stored);
    expect(resetFields).toEqual(["overlay", "unknown:legacyFlag", "unknown:?"]);
    expect(prefs).toEqual(defaultPreferences());
    expect("legacyFlag" in prefs).toBe(false);
  });

  it("a non-object → all defaults, every field reported", () => {
    for (const raw of [null, "prefs", 42, [1, 2]]) {
      const r = parsePreferences(raw);
      expect(r.prefs).toEqual(defaultPreferences());
      expect(r.resetFields).toEqual([...PREF_KEYS]);
    }
  });

  it("explicit null for a nullable field is valid; undefined counts as missing", () => {
    const r = parsePreferences({ ...defaultPreferences(), quietHours: null, notificationsSeen: undefined });
    expect(r.resetFields).toEqual(["notificationsSeen"]);
  });
});

describe("runMigrations", () => {
  const v0: LocalData = { prefs: { theme: "old" }, meta: { schemaVersion: 0 } };
  const addFlag: Migration = {
    from: 0,
    to: 1,
    // Idempotent: checks the shape before acting.
    migrate: (d) => (d.migrated === true ? d : { ...d, migrated: true }),
  };
  const toTwo: Migration = { from: 1, to: 2, migrate: (d) => ({ ...d, two: true }) };

  it("the shipped list is empty and schema 1 is current", () => {
    expect(MIGRATIONS).toEqual([]);
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    expect(runMigrations({ a: 1 }, 1)).toEqual({ ok: true, data: { a: 1 }, version: 1, applied: 0 });
  });

  it("applies steps in order and leaves the input untouched", () => {
    const r = runMigrations(v0, 0, [toTwo, addFlag], 2);
    expect(r).toEqual({ ok: true, data: { ...v0, migrated: true, two: true }, version: 2, applied: 2 });
    expect(v0).toEqual({ prefs: { theme: "old" }, meta: { schemaVersion: 0 } });
  });

  it("each fixture step is idempotent", () => {
    const once = addFlag.migrate(v0);
    expect(addFlag.migrate(once)).toEqual(once);
  });

  it("a failing step returns only an error, no partial output", () => {
    const boom: Migration = {
      from: 1,
      to: 2,
      migrate: () => {
        throw new Error("boom");
      },
    };
    const r = runMigrations(v0, 0, [addFlag, boom], 2);
    expect(r).toEqual({ ok: false, errors: ["E_MIGRATION_FAILED_1_2"] });
    expect("data" in r).toBe(false);
  });

  it("rejects gaps, bad steps, bad versions and downgrades", () => {
    expect(runMigrations(v0, 0, [toTwo], 2)).toEqual({ ok: false, errors: ["E_MIGRATION_NO_PATH"] });
    expect(runMigrations(v0, 0, [], 1)).toEqual({ ok: false, errors: ["E_MIGRATION_NO_PATH"] });
    expect(runMigrations(v0, 0, [{ from: 0, to: 3, migrate: (d) => d }], 2)).toEqual({
      ok: false,
      errors: ["E_MIGRATION_NO_PATH"],
    });
    expect(runMigrations(v0, 0, [{ from: 1, to: 1, migrate: (d) => d }], 2)).toEqual({
      ok: false,
      errors: ["E_MIGRATION_BAD_STEP"],
    });
    expect(runMigrations(v0, 0.5, [])).toEqual({ ok: false, errors: ["E_MIGRATION_BAD_VERSION"] });
    expect(runMigrations(v0, -1, [])).toEqual({ ok: false, errors: ["E_MIGRATION_BAD_VERSION"] });
    expect(runMigrations(v0, 2, [])).toEqual({ ok: false, errors: ["E_SCHEMA_NEWER_THAN_BUILD"] });
  });
});

describe("appendDiag", () => {
  it("appends codes and caps at 200, dropping the oldest", () => {
    let log = appendDiag([], { at: 1, code: "E_ONE" });
    expect(log).toEqual([{ at: 1, code: "E_ONE" }]);
    for (let i = 0; i < 250; i++) log = appendDiag(log, { at: i, code: "E_MANY" });
    expect(log).toHaveLength(DIAG_CAP);
    expect(log[0]).toEqual({ at: 50, code: "E_MANY" });
    expect(log.at(-1)).toEqual({ at: 249, code: "E_MANY" });
  });

  it("replaces anything that isn't a code (free text could hold a URL)", () => {
    for (const code of ["failed on https://mail.example/inbox", "lower_case", "E", "E_" + "X".repeat(40), ""]) {
      expect(appendDiag([], { at: 1, code })).toEqual([{ at: 1, code: INVALID_DIAG_CODE }]);
    }
    expect(appendDiag([], { at: 1, code: "E_" + "X".repeat(39) })[0]?.code).toBe("E_" + "X".repeat(39));
  });

  it("normalises bad timestamps and honours a custom cap", () => {
    expect(normaliseDiagEntry({ at: Number.NaN, code: "E_X1" })).toEqual({ at: 0, code: "E_X1" });
    expect(normaliseDiagEntry({ at: -3, code: "E_X1" }).at).toBe(0);
    const log = [1, 2, 3].map((at) => ({ at, code: "E_ABC" }));
    expect(appendDiag(log, { at: 4, code: "E_ABC" }, 2)).toEqual([
      { at: 3, code: "E_ABC" },
      { at: 4, code: "E_ABC" },
    ]);
    expect(appendDiag(log, { at: 4, code: "E_ABC" }, 0)).toEqual([]);
    expect(appendDiag(log, { at: 4, code: "E_ABC" }, 1.5)).toEqual([]);
  });

  it("does not mutate the input log", () => {
    const log = [{ at: 1, code: "E_ABC" }];
    appendDiag(log, { at: 2, code: "E_DEF" });
    expect(log).toEqual([{ at: 1, code: "E_ABC" }]);
  });
});

describe("retention cutoff", () => {
  it("is now minus retentionDays", () => {
    expect(cutoff(100 * DAY_MS, 30)).toBe(70 * DAY_MS);
    expect(cutoff(100 * DAY_MS, 90)).toBe(10 * DAY_MS);
    expect(isExpired(70 * DAY_MS - 1, cutoff(100 * DAY_MS, 30))).toBe(true);
    expect(isExpired(70 * DAY_MS, cutoff(100 * DAY_MS, 30))).toBe(false);
  });

  it("retention 0 → everything is expired, even records ending now or later", () => {
    const c = cutoff(1_000, 0);
    expect(c).toBe(Number.POSITIVE_INFINITY);
    expect(isExpired(1_000, c)).toBe(true);
    expect(isExpired(10_000_000, c)).toBe(true);
  });

  it("rejects invalid inputs", () => {
    expect(() => cutoff(Number.NaN, 30)).toThrow(RangeError);
    expect(() => cutoff(0, 91)).toThrow(RangeError);
    expect(() => cutoff(0, -1)).toThrow(RangeError);
    expect(() => cutoff(0, 1.5)).toThrow(RangeError);
  });
});
