// Repositories validate on write AND on read (DATA_MODEL §8).
import { describe, expect, it } from "vitest";
import { defaultPreferences } from "../../../src/core/storage/defaults";
import { cutoff, DAY_MS } from "../../../src/core/storage/retention";
import { openFb, runTx } from "../../../src/shell/storage/idb";
import {
  interventionsRepo,
  SEGMENT_CAP,
  segmentsRepo,
  sessionsRepo,
  type IdbRepoDeps,
} from "../../../src/shell/storage/idbRepos";
import {
  activeRepo,
  diagRepo,
  diagSink,
  KEY_ACTIVE,
  KEY_DIAG,
  KEY_OVERRIDES,
  KEY_PREFS,
  metaRepo,
  overridesRepo,
  prefsRepo,
} from "../../../src/shell/storage/kvRepos";
import { memoryKv } from "../../../src/shell/storage/memoryKv";
import { activeState, freshFactory, intervention, keyRange, segment, sessionRecord } from "./fixtures";

async function setup() {
  const local = memoryKv();
  const diag = diagRepo(local, () => 42);
  const db = await openFb(freshFactory());
  const deps: IdbRepoDeps = { db, keyRange, onInvalid: diagSink(diag) };
  return { local, diag, db, deps };
}

/** Writes a raw row straight into a store, bypassing every repository check. */
function putRaw(db: IDBDatabase, store: string, row: unknown): Promise<void> {
  return runTx(db, store, "readwrite", (tx) => {
    tx.objectStore(store).put(row);
    return () => undefined;
  });
}

function rawAll(db: IDBDatabase, store: string): Promise<unknown[]> {
  return runTx(db, store, "readonly", (tx) => {
    const r = tx.objectStore(store).getAll();
    return (): unknown[] => r.result;
  });
}

describe("diagRepo", () => {
  it("appends, lists, drops invalid stored entries and clears", async () => {
    const local = memoryKv({ [KEY_DIAG]: [{ at: 1, code: "E_OLD" }, { at: 2, code: "free text" }, "junk"] });
    const diag = diagRepo(local, () => 7);
    expect(await diag.list()).toEqual([{ at: 1, code: "E_OLD" }]);
    await diag.append("E_NEW");
    await diag.appendMany([]);
    await diag.append("not a code");
    expect(await diag.list()).toEqual([
      { at: 1, code: "E_OLD" },
      { at: 7, code: "E_NEW" },
      { at: 7, code: "E_INVALID_DIAG_CODE" },
    ]);
    await diag.clear();
    expect(await diag.list()).toEqual([]);
    await local.set(KEY_DIAG, "not an array");
    expect(await diag.list()).toEqual([]);
  });

  it("diagSink never throws", async () => {
    const broken = memoryKv();
    broken.set = () => Promise.reject(new Error("quota"));
    await expect(diagSink(diagRepo(broken, () => 1))("E_X1", 2)).resolves.toBeUndefined();
  });
});

describe("prefsRepo", () => {
  it("get: defaults when absent; per-field fallback when invalid (AC-15)", async () => {
    const local = memoryKv();
    const repo = prefsRepo(local);
    expect(await repo.get()).toEqual({ prefs: defaultPreferences(), resetFields: [] });
    await local.set(KEY_PREFS, { ...defaultPreferences(), maxPerHour: 50, retentionDays: 3, extra: 1 });
    const r = await repo.get();
    expect(r.resetFields).toEqual(["maxPerHour", "unknown:extra"]);
    expect(r.prefs.maxPerHour).toBe(4);
    expect(r.prefs.retentionDays).toBe(3);
  });

  it("update merges a validated patch; an invalid patch writes nothing", async () => {
    const local = memoryKv();
    const repo = prefsRepo(local);
    const ok = await repo.update({ retentionDays: 7, defaultMode: "strict" });
    expect(ok).toMatchObject({ ok: true, prefs: { retentionDays: 7, defaultMode: "strict" } });
    expect(await local.get(KEY_PREFS)).toMatchObject({ retentionDays: 7, defaultMode: "strict", maxPerHour: 4 });
    const before = await local.get(KEY_PREFS);
    expect(await repo.update({ maxPerHour: 7 })).toMatchObject({ ok: false });
    expect(await repo.update({ cooldownMin: { gentle: 15, adaptive: 10, strict: 2 } })).toMatchObject({ ok: false });
    expect(await repo.update({ title: "x" })).toEqual({ ok: false, errors: ["prefs.title:unknown_key"] });
    expect(await repo.update("x")).toEqual({ ok: false, errors: ["patch:not_object"] });
    expect(await local.get(KEY_PREFS)).toEqual(before);
  });

  it("put validates strictly; reset writes the defaults", async () => {
    const local = memoryKv();
    const repo = prefsRepo(local);
    expect(await repo.put({ ...defaultPreferences(), retentionDays: 91 })).toMatchObject({ ok: false });
    expect(await local.get(KEY_PREFS)).toBeUndefined();
    expect(await repo.put(defaultPreferences())).toEqual({ ok: true });
    await repo.update({ retentionDays: 1 });
    expect(await repo.reset()).toEqual(defaultPreferences());
    expect(await local.get(KEY_PREFS)).toEqual(defaultPreferences());
  });
});

describe("overridesRepo", () => {
  it("adds, dedupes and removes under overrides.global", async () => {
    const local = memoryKv();
    const diag = diagRepo(local, () => 1);
    const repo = overridesRepo(local, diagSink(diag));
    expect(await repo.list()).toEqual([]);
    expect(await repo.add({ host: "a.com", createdAt: 1 })).toEqual({ ok: true, added: true });
    expect(await repo.add({ host: "a.com", createdAt: 2 })).toEqual({ ok: true, added: false });
    expect(await repo.add({ host: "a.com", titleSubstring: "Docs", createdAt: 3 })).toEqual({ ok: true, added: true });
    expect(await repo.add({ host: "b.com", createdAt: 4 })).toEqual({ ok: true, added: true });
    expect(await local.get(KEY_OVERRIDES)).toHaveLength(3);
    expect(await repo.remove("a.com", "Docs")).toBe(1);
    expect(await repo.remove("a.com")).toBe(1);
    expect(await repo.list()).toEqual([{ host: "b.com", createdAt: 4 }]);
  });

  it("rejects invalid overrides on write", async () => {
    const repo = overridesRepo(memoryKv(), diagSink(diagRepo(memoryKv(), () => 1)));
    expect(await repo.add({ host: "a.com/path", createdAt: 1 })).toMatchObject({ ok: false });
    expect(await repo.add({ host: "a.com", titleSubstring: "x".repeat(61), createdAt: 1 })).toMatchObject({
      ok: false,
    });
  });

  it("skips invalid stored rows and counts them in diag; drops stored duplicates", async () => {
    const local = memoryKv({
      [KEY_OVERRIDES]: [
        { host: "a.com", createdAt: 1 },
        { host: "a.com", createdAt: 5 },
        { host: "a.com", createdAt: 1, url: "https://a.com/secret" },
        "junk",
      ],
    });
    const diag = diagRepo(local, () => 9);
    const repo = overridesRepo(local, diagSink(diag));
    expect(await repo.list()).toEqual([{ host: "a.com", createdAt: 1 }]);
    expect((await diag.list()).map((e) => e.code)).toEqual(["E_INVALID_OVERRIDE_ROW", "E_INVALID_OVERRIDE_ROW"]);
    await local.set(KEY_OVERRIDES, { not: "an array" });
    expect(await repo.list()).toEqual([]);
    expect((await diag.list()).at(-1)?.code).toBe("E_INVALID_OVERRIDES");
  });
});

describe("overridesRepo cap (§8.1: overrides.global ≤ 200)", () => {
  it("accepts the 200th override and refuses the 201st", async () => {
    const local = memoryKv({
      [KEY_OVERRIDES]: Array.from({ length: 199 }, (_, i) => ({ host: `h${i}.com`, createdAt: 1 })),
    });
    const repo = overridesRepo(local, diagSink(diagRepo(local, () => 1)));
    expect(await repo.add({ host: "last.com", createdAt: 2 })).toEqual({ ok: true, added: true });
    expect(await repo.list()).toHaveLength(200);
    expect(await repo.add({ host: "one-more.com", createdAt: 3 })).toEqual({
      ok: false,
      errors: ["overrides:too_many"],
    });
    expect(await local.get(KEY_OVERRIDES)).toHaveLength(200);
    // A duplicate at the cap is still a no-op success.
    expect(await repo.add({ host: "last.com", createdAt: 4 })).toEqual({ ok: true, added: false });
  });

  it("a stored list over the cap is read back as its first 200 and counted in diag", async () => {
    const local = memoryKv({
      [KEY_OVERRIDES]: Array.from({ length: 201 }, (_, i) => ({ host: `h${i}.com`, createdAt: 1 })),
    });
    const diag = diagRepo(local, () => 1);
    const list = await overridesRepo(local, diagSink(diag)).list();
    expect(list).toHaveLength(200);
    expect(list.at(-1)?.host).toBe("h199.com");
    expect((await diag.list()).map((e) => e.code)).toEqual(["E_OVERRIDES_OVER_CAP"]);
  });
});

describe("activeRepo", () => {
  it("none, valid state, corrupt state", async () => {
    const local = memoryKv();
    const repo = activeRepo(local);
    expect(await repo.get()).toEqual({ none: true });
    expect(await repo.put(activeState())).toEqual({ ok: true });
    expect(await repo.get()).toEqual({ state: activeState() });
    await local.set(KEY_ACTIVE, { ...activeState(), title: "Inbox" });
    expect(await repo.get()).toEqual({ corrupt: true });
    await local.set(KEY_ACTIVE, "garbage");
    expect(await repo.get()).toEqual({ corrupt: true });
    await repo.remove();
    expect(await repo.get()).toEqual({ none: true });
  });

  it("rejects an invalid state on write", async () => {
    const local = memoryKv();
    const repo = activeRepo(local);
    const s = activeState();
    expect(await repo.put({ ...s, lastRelevant: { tabId: 1, host: "a.com/x", at: 1 } })).toMatchObject({ ok: false });
    expect(await local.get(KEY_ACTIVE)).toBeUndefined();
  });
});

describe("metaRepo", () => {
  it("get/put with validation", async () => {
    const local = memoryKv();
    const repo = metaRepo(local);
    expect(await repo.get()).toBeNull();
    expect(await repo.put({ schemaVersion: 2, installedAt: 1 })).toMatchObject({ ok: false });
    expect(await repo.put({ schemaVersion: 1, installedAt: 1 })).toEqual({ ok: true });
    expect(await repo.get()).toEqual({ schemaVersion: 1, installedAt: 1 });
    await local.set("meta", { schemaVersion: 1 });
    expect(await repo.get()).toBeNull();
  });
});

describe("segmentsRepo", () => {
  it("append, list, count, closeLast, deleteForSession, clearAll", async () => {
    const { db, deps } = await setup();
    const repo = segmentsRepo(deps);
    const open: Record<string, unknown> = { ...segment({ seq: 1, start: 2_000 }) };
    delete open.end;
    expect(await repo.append(segment())).toEqual({ ok: true, outcome: "appended" });
    expect(await repo.append(open)).toEqual({ ok: true, outcome: "appended" });
    expect(await repo.append(segment({ sessionId: "s2" }))).toMatchObject({ ok: true });
    expect(await repo.count("s1")).toBe(2);
    expect(await repo.closeLast("s1", 1_500)).toBe(false); // end before start
    expect(await repo.closeLast("s1", 3_000)).toBe(true);
    expect(await repo.closeLast("s1", 4_000)).toBe(false); // already closed
    expect(await repo.closeLast("none", 4_000)).toBe(false);
    expect(await repo.closeLast("s1", Number.NaN)).toBe(false);
    expect((await repo.listForSession("s1")).map((s) => [s.seq, s.end])).toEqual([
      [0, 2_000],
      [1, 3_000],
    ]);
    await repo.deleteForSession("s1");
    expect(await repo.count("s1")).toBe(0);
    expect(await repo.count("s2")).toBe(1);
    await repo.clearAll();
    expect(await repo.count("s2")).toBe(0);
    db.close();
  });

  it("rejects invalid segments on write (title/url/path, host rules)", async () => {
    const { db, deps } = await setup();
    const repo = segmentsRepo(deps);
    for (const bad of [
      { ...segment(), title: "Inbox (3)" },
      { ...segment(), url: "https://mail.example/inbox" },
      { ...segment(), path: "/inbox" },
      segment({ host: "mail.example/inbox" }),
      segment({ host: "Mail.Example" }),
      segment({ reason: "ephemeral" }),
    ]) {
      expect(await repo.append(bad)).toMatchObject({ ok: false });
    }
    expect(await rawAll(db, "segments")).toEqual([]);
    db.close();
  });

  it.each(["title", "url", "path"])(
    "a stored row with a %s key is skipped on read and counted in diag",
    async (key) => {
      const { db, deps, diag } = await setup();
      const repo = segmentsRepo(deps);
      await repo.append(segment({ seq: 0 }));
      await putRaw(db, "segments", { ...segment({ seq: 1 }), [key]: "secret" });
      const listed = await repo.listForSession("s1");
      expect(listed).toEqual([segment({ seq: 0 })]);
      expect(JSON.stringify(listed)).not.toContain("secret");
      expect(await diag.list()).toEqual([{ at: 42, code: "E_INVALID_SEGMENT_ROW" }]);
      // closeLast also refuses to touch (or return) the invalid row.
      expect(await repo.closeLast("s1", 9_000)).toBe(false);
      expect((await diag.list()).length).toBe(2);
      db.close();
    },
  );

  it("cap: at the cap the last segment's end is extended instead of inserting (invariant 6)", async () => {
    const { db, deps } = await setup();
    const repo = segmentsRepo(deps, 3);
    for (let seq = 0; seq < 3; seq++) {
      await repo.append(segment({ seq, start: seq * 10, end: seq * 10 + 5 }));
    }
    expect(await repo.append(segment({ seq: 3, start: 30, end: 40, host: "other.example" }))).toEqual({
      ok: true,
      outcome: "extended",
    });
    expect(await repo.count("s1")).toBe(3);
    const rows = await repo.listForSession("s1");
    expect(rows.at(-1)).toEqual(segment({ seq: 2, start: 20, end: 40 }));
    // An open new segment re-opens the last one (it continues until closeLast).
    const open: Record<string, unknown> = { ...segment({ seq: 4, start: 41 }) };
    delete open.end;
    expect(await repo.append(open)).toMatchObject({ outcome: "extended" });
    expect((await repo.listForSession("s1")).at(-1)?.end).toBeUndefined();
    expect(await repo.closeLast("s1", 50)).toBe(true);
    expect((await repo.listForSession("s1")).at(-1)?.end).toBe(50);
    // Other sessions have their own cap.
    expect(await repo.append(segment({ sessionId: "s2" }))).toMatchObject({ outcome: "appended" });
    db.close();
  });

  it("cap: an invalid last row is not extended; the new segment is dropped and counted", async () => {
    const { db, deps, diag } = await setup();
    const repo = segmentsRepo(deps, 1);
    await putRaw(db, "segments", { ...segment(), title: "x" });
    expect(await repo.append(segment({ seq: 1 }))).toEqual({ ok: true, outcome: "dropped" });
    expect((await diag.list()).map((e) => e.code)).toEqual(["E_INVALID_SEGMENT_ROW"]);
    db.close();
  });

  it(`cap: a real run at SEGMENT_CAP (${SEGMENT_CAP}) rows`, async () => {
    const { db, deps } = await setup();
    const repo = segmentsRepo(deps);
    // Fill to the cap in one transaction (fast), then append through the repo.
    await runTx(db, "segments", "readwrite", (tx) => {
      const store = tx.objectStore("segments");
      for (let seq = 0; seq < SEGMENT_CAP; seq++) store.put(segment({ seq, start: seq, end: seq + 1 }));
      return () => undefined;
    });
    expect(await repo.count("s1")).toBe(SEGMENT_CAP);
    expect(await repo.append(segment({ seq: SEGMENT_CAP, start: SEGMENT_CAP, end: SEGMENT_CAP + 10 }))).toEqual({
      ok: true,
      outcome: "extended",
    });
    expect(await repo.count("s1")).toBe(SEGMENT_CAP);
    const last = (await repo.listForSession("s1")).at(-1);
    expect(last).toMatchObject({ seq: SEGMENT_CAP - 1, end: SEGMENT_CAP + 10 });
    db.close();
  });
});

describe("interventionsRepo", () => {
  it("put/list/delete per session; rejects host keys on write and read", async () => {
    const { db, deps, diag } = await setup();
    const repo = interventionsRepo(deps);
    expect(await repo.put(intervention())).toEqual({ ok: true });
    expect(await repo.put(intervention({ id: "i2", response: "back", respondedAt: 6_000 }))).toEqual({ ok: true });
    expect(await repo.put(intervention({ sessionId: "s2" }))).toEqual({ ok: true });
    expect(await repo.put({ ...intervention({ id: "i3" }), host: "a.com" })).toMatchObject({ ok: false });
    await putRaw(db, "interventions", { ...intervention({ id: "i4" }), host: "leak.example" });
    const listed = await repo.listForSession("s1");
    expect(listed.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect((await diag.list()).map((e) => e.code)).toEqual(["E_INVALID_INTERVENTION_ROW"]);
    await repo.deleteForSession("s1");
    expect(await repo.listForSession("s1")).toEqual([]);
    expect(await repo.listForSession("s2")).toHaveLength(1);
    db.close();
  });
});

describe("sessionsRepo", () => {
  it("put/get/list/delete with validation", async () => {
    const { db, deps, diag } = await setup();
    const repo = sessionsRepo(deps);
    const interventions = interventionsRepo(deps);
    for (let i = 0; i < 5; i++) {
      expect(await repo.put(sessionRecord({ id: `s${i}`, startedAt: i * 100, endedAt: i * 100 + 50 }))).toEqual({
        ok: true,
      });
    }
    const tooMany = sessionRecord({ id: "bad" });
    tooMany.summary.relevantHosts = Array.from({ length: 11 }, (_, i) => ({ host: `h${i}.com`, minutes: 1 }));
    expect(await repo.put(tooMany)).toMatchObject({ ok: false });
    expect(await repo.get("s3")).toEqual(sessionRecord({ id: "s3", startedAt: 300, endedAt: 350 }));
    expect(await repo.get("missing")).toBeNull();
    expect((await repo.list()).map((s) => s.id)).toEqual(["s4", "s3", "s2", "s1", "s0"]);
    expect((await repo.list({ limit: 2 })).map((s) => s.id)).toEqual(["s4", "s3"]);
    expect((await repo.list({ limit: 2, before: 350 })).map((s) => s.id)).toEqual(["s2", "s1"]);
    expect((await repo.list({ limit: 0 })).map((s) => s.id)).toEqual(["s4"]);
    expect(await repo.list({ limit: 1.5 })).toHaveLength(5);

    // Invalid stored rows are skipped and counted.
    await putRaw(db, "sessions", { ...sessionRecord({ id: "x1", endedAt: 400 }), title: "secret" });
    expect((await repo.list()).map((s) => s.id)).toEqual(["s4", "s3", "s2", "s1", "s0"]);
    expect(await repo.get("x1")).toBeNull();
    expect((await diag.list()).map((e) => e.code)).toEqual(["E_INVALID_SESSION_ROW", "E_INVALID_SESSION_ROW"]);

    await interventions.put(intervention({ sessionId: "s2" }));
    await repo.delete("s2");
    expect(await repo.get("s2")).toBeNull();
    expect(await interventions.listForSession("s2")).toEqual([]);
    db.close();
  });

  it("list never returns more than 50", async () => {
    const { db, deps } = await setup();
    const repo = sessionsRepo(deps);
    for (let i = 0; i < 55; i++) await repo.put(sessionRecord({ id: `s${i}`, endedAt: 1_000 + i }));
    expect(await repo.list({ limit: 500 })).toHaveLength(50);
    db.close();
  });

  it("pruneOlderThan deletes expired sessions and their interventions in one transaction", async () => {
    const { db, deps } = await setup();
    const repo = sessionsRepo(deps);
    const interventions = interventionsRepo(deps);
    const now = 100 * DAY_MS;
    await repo.put(sessionRecord({ id: "old", startedAt: 0, endedAt: 10 * DAY_MS }));
    await repo.put(sessionRecord({ id: "new", startedAt: 0, endedAt: 90 * DAY_MS }));
    await interventions.put(intervention({ sessionId: "old", id: "a", createdAt: 5 * DAY_MS }));
    await interventions.put(intervention({ sessionId: "old", id: "b", createdAt: 5 * DAY_MS }));
    await interventions.put(intervention({ sessionId: "new", id: "c", createdAt: 89 * DAY_MS }));
    // An orphan (session ended without a summary) and a recent orphan (current session).
    await interventions.put(intervention({ sessionId: "gone", id: "d", createdAt: 5 * DAY_MS }));
    await interventions.put(intervention({ sessionId: "live", id: "e", createdAt: 99 * DAY_MS }));

    expect(await repo.pruneOlderThan(cutoff(now, 30))).toEqual({ sessions: 1, orphanInterventions: 1 });
    expect(await repo.get("old")).toBeNull();
    expect(await repo.get("new")).not.toBeNull();
    expect(await interventions.listForSession("old")).toEqual([]);
    expect(await interventions.listForSession("gone")).toEqual([]);
    expect((await interventions.listForSession("new")).map((i) => i.id)).toEqual(["c"]);
    expect((await interventions.listForSession("live")).map((i) => i.id)).toEqual(["e"]);
    expect(await repo.pruneOlderThan(Number.NaN)).toEqual({ sessions: 0, orphanInterventions: 0 });
    db.close();
  });

  it("retention 0 deletes every session and every intervention", async () => {
    const { db, deps } = await setup();
    const repo = sessionsRepo(deps);
    const interventions = interventionsRepo(deps);
    const now = 100 * DAY_MS;
    await repo.put(sessionRecord({ id: "a", endedAt: now }));
    await repo.put(sessionRecord({ id: "b", endedAt: now - 1 }));
    await putRaw(db, "sessions", { id: "no-ended-at", title: "corrupt" });
    await interventions.put(intervention({ sessionId: "a" }));
    await interventions.put(intervention({ sessionId: "zzz" }));
    expect(await repo.pruneOlderThan(cutoff(now, 0))).toEqual({ sessions: 3, orphanInterventions: 0 });
    expect(await rawAll(db, "sessions")).toEqual([]);
    expect(await rawAll(db, "interventions")).toEqual([]);
    db.close();
  });

  it("a failed transaction leaves everything in place", async () => {
    const { db, deps } = await setup();
    const repo = sessionsRepo(deps);
    await repo.put(sessionRecord({ id: "old", endedAt: 1 }));
    db.close();
    await expect(repo.pruneOlderThan(10)).rejects.toMatchObject({ code: "E_IDB_TX_OPEN" });
  });
});
