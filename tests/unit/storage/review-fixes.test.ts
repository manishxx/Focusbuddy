// Regression tests for the Day 06 review of 674752c (F1–F12). The "probe" tests
// replay the reviewer's attacks and show they now fail safely.
import { IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPreferences } from "../../../src/core/storage/defaults";
import { DAY_MS, cutoff } from "../../../src/core/storage/retention";
import { nullObject, SNAPSHOT_MAX_ARRAY, snapshotPlain, trySnapshot } from "../../../src/core/storage/snapshot";
import {
  isSafeTitleSubstring,
  parsePreferences,
  validateActiveState,
  validateOverride,
  validatePreferences,
  validateSegment,
  validateSessionRecord,
  type Result,
} from "../../../src/core/storage/validate";
import { openFb, request, runTx } from "../../../src/shell/storage/idb";
import { interventionsRepo, segmentsRepo, sessionsRepo, type IdbRepoDeps } from "../../../src/shell/storage/idbRepos";
import type { KvArea } from "../../../src/shell/storage/kv";
import { isKeyLocked, withKeyLock } from "../../../src/shell/storage/kvLock";
import {
  activeRepo,
  diagRepo,
  diagSink,
  KEY_ACTIVE,
  KEY_DIAG,
  KEY_META,
  KEY_OVERRIDES,
  KEY_PREFS,
  metaRepo,
  overridesRepo,
  prefsRepo,
} from "../../../src/shell/storage/kvRepos";
import { memoryKv } from "../../../src/shell/storage/memoryKv";
import { openStorage, type OpenStorageOptions } from "../../../src/shell/storage/openStorage";
import { activeState, freshFactory, intervention, keyRange, segment, sessionRecord } from "./fixtures";
import { jsonKv } from "./jsonKv";

const NOW = 100 * DAY_MS;
const SECRET = "Inbox (3) - Secret project - Mail";
const errorsOf = <T>(r: Result<T>): string[] => (r.ok ? [] : r.errors);

function options(over: Partial<OpenStorageOptions> = {}): OpenStorageOptions {
  return {
    local: memoryKv(),
    session: memoryKv(),
    idbFactory: freshFactory(),
    now: () => NOW,
    idbKeyRange: keyRange,
    ...over,
  };
}

async function idbSetup() {
  const local = memoryKv();
  const diag = diagRepo(local, () => 1);
  const db = await openFb(freshFactory());
  const deps: IdbRepoDeps = { db, keyRange, onInvalid: diagSink(diag) };
  return { local, diag, db, deps };
}

function putRaw(db: IDBDatabase, store: string, rows: unknown[]): Promise<void> {
  return runTx(db, store, "readwrite", (tx) => {
    for (const row of rows) tx.objectStore(store).put(row);
    return () => undefined;
  });
}

/** A KvArea that keeps references (no clone), to see exactly what a repository writes. */
function recordingKv(): KvArea & { written: Map<string, unknown> } {
  const written = new Map<string, unknown>();
  return {
    written,
    get: (k) => Promise.resolve(written.get(k)),
    set: (k, v) => {
      written.set(k, v);
      return Promise.resolve();
    },
    remove: (k) => {
      written.delete(k);
      return Promise.resolve();
    },
    clear: () => {
      written.clear();
      return Promise.resolve();
    },
  };
}

/** A KvArea whose operations resolve after a random delay, to expose lost updates. */
function slowKv(): KvArea {
  const inner = memoryKv();
  const later = <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => setTimeout(() => void fn().then(resolve, reject), Math.random() * 3));
  return {
    get: (k) => later(() => inner.get(k)),
    set: (k, v) => later(() => inner.set(k, v)),
    remove: (k) => later(() => inner.remove(k)),
    clear: () => later(() => inner.clear()),
  };
}

/** Adds a non-enumerable `title` and a symbol-keyed field; neither may be stored. */
function withHiddenExtras<T extends object>(value: T): T {
  Object.defineProperty(value, "title", { value: SECRET, enumerable: false });
  Object.defineProperty(value, Symbol("url"), { value: "https://mail.example/inbox", enumerable: true });
  return value;
}

function expectNoExtras(stored: unknown): void {
  expect(stored).toBeTypeOf("object");
  const o = stored as object;
  expect(Object.getOwnPropertyNames(o)).not.toContain("title");
  expect(Object.getOwnPropertySymbols(o)).toEqual([]);
  expect(JSON.stringify(o)).not.toContain("Secret");
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- F1
describe("F1: validators work on a read-once snapshot (no TOCTOU)", () => {
  it("probe: an obsKey getter that turns into a title on the 4th read is rejected and never stored", async () => {
    let reads = 0;
    const current = { segmentSeq: 0, tabId: 7, class: "RELEVANT", since: 1_000 };
    Object.defineProperty(current, "obsKey", {
      enumerable: true,
      get: () => (++reads >= 4 ? SECRET : "h:abc123"),
    });
    const state = { ...activeState(), current };
    expect(errorsOf(validateActiveState(state))).toEqual(["active:not_cloneable"]);
    expect(reads).toBe(0); // the getter never even ran
    const local = memoryKv();
    expect(await activeRepo(local).put(state)).toEqual({ ok: false, errors: ["active:not_cloneable"] });
    expect(await local.get(KEY_ACTIVE)).toBeUndefined();
  });

  it("probe: a getter-based host is rejected", () => {
    const seg = { ...segment() } as Record<string, unknown>;
    delete seg.host;
    Object.defineProperty(seg, "host", { enumerable: true, get: () => "docs.example.com" });
    expect(errorsOf(validateSegment(seg))).toEqual(["segment:not_cloneable"]);
  });

  it("probe: a Proxy whose get trap returns a title can't smuggle it in", () => {
    const target = segment();
    const proxy = new Proxy(target, {
      get: (t, k) => (k === "host" ? SECRET : (t as Record<PropertyKey, unknown>)[k]),
    });
    const r = validateSegment(proxy);
    // Values are read through property descriptors, never through `get`: the stored host is the target's.
    expect(r).toEqual({ ok: true, value: target });
    expect(JSON.stringify(r)).not.toContain("Secret");
  });

  it("a Proxy that serves a title through its descriptor trap is validated (and rejected) on that one read", () => {
    let calls = 0;
    const proxy = new Proxy(segment(), {
      getOwnPropertyDescriptor: (t, k) => {
        const d = Object.getOwnPropertyDescriptor(t, k);
        if (k === "host" && d) {
          calls += 1;
          return { ...d, value: SECRET };
        }
        return d;
      },
    });
    expect(errorsOf(validateSegment(proxy))).toEqual(["segment.host:invalid_host"]);
    expect(calls).toBe(1);
  });

  it("a Proxy whose traps throw is not cloneable", () => {
    const proxy = new Proxy(segment(), {
      ownKeys: () => {
        throw new Error("trap");
      },
    });
    expect(errorsOf(validateSegment(proxy))).toEqual(["segment:not_cloneable"]);
    expect(parsePreferences(proxy).resetFields.length).toBeGreaterThan(0);
  });

  it("parsePreferences treats non-plain input as a non-object", () => {
    const p = { ...defaultPreferences() } as Record<string, unknown>;
    Object.defineProperty(p, "retentionDays", { enumerable: true, get: () => 0 });
    const r = parsePreferences(p);
    expect(r.prefs).toEqual(defaultPreferences());
    expect(r.resetFields).toContain("retentionDays");
  });

  it("prefs.update reads the patch once and rejects accessors", async () => {
    const local = memoryKv();
    const patch = {};
    Object.defineProperty(patch, "retentionDays", { enumerable: true, get: () => 0 });
    expect(await prefsRepo(local).update(patch)).toEqual({ ok: false, errors: ["patch:not_cloneable"] });
    expect(await local.get(KEY_PREFS)).toBeUndefined();
  });

  describe("snapshotPlain", () => {
    it("copies plain data into null-prototype objects and keeps holes", () => {
      // eslint-disable-next-line no-sparse-arrays
      const src = { a: 1, b: "x", c: null, d: [1, , 3], e: { f: true }, g: undefined };
      const out = snapshotPlain(src) as Record<string, unknown>;
      expect(out).toEqual(src);
      expect(out).not.toBe(src);
      expect(Object.getPrototypeOf(out)).toBeNull();
      expect(1 in (out.d as unknown[])).toBe(false);
      expect(snapshotPlain(Object.create(null))).toEqual({});
      expect(snapshotPlain("s")).toBe("s");
    });

    it("drops non-enumerable and symbol-keyed properties; __proto__ is plain data", () => {
      const src = withHiddenExtras({ a: 1 });
      expect(Object.getOwnPropertyNames(snapshotPlain(src))).toEqual(["a"]);
      const parsed = JSON.parse('{"__proto__": {"polluted": true}}') as object;
      const out = snapshotPlain(parsed) as Record<string, unknown>;
      expect(Object.getPrototypeOf(out)).toBeNull();
      expect(Object.keys(out)).toEqual(["__proto__"]);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it.each([
      ["a function", () => 1, "type_function"],
      ["a symbol", Symbol("x"), "type_symbol"],
      ["a bigint", 1n, "type_bigint"],
      ["a Date", new Date(0), "not_plain"],
      ["a Map", new Map(), "not_plain"],
      ["a class instance", new (class A {})(), "not_plain"],
      ["a nested function", { a: { b: () => 1 } }, "type_function"],
    ])("rejects %s", (_, value, reason) => {
      expect(trySnapshot(value)).toEqual({ ok: false, reason });
    });

    it("rejects cycles, excessive depth, long arrays and arrays with extra keys", () => {
      const cyc: Record<string, unknown> = {};
      cyc.self = cyc;
      expect(trySnapshot(cyc)).toEqual({ ok: false, reason: "cycle" });
      const deep = (n: number): unknown => (n === 0 ? 1 : { x: deep(n - 1) });
      expect(trySnapshot(deep(8)).ok).toBe(true);
      expect(trySnapshot(deep(9))).toEqual({ ok: false, reason: "too_deep" });
      const long: unknown[] = [];
      long.length = SNAPSHOT_MAX_ARRAY + 1;
      expect(trySnapshot(long)).toEqual({ ok: false, reason: "too_long" });
      const extra = Object.assign([1], { title: SECRET });
      expect(trySnapshot(extra)).toEqual({ ok: false, reason: "array_extra_key" });
      const getterArr = [1];
      Object.defineProperty(getterArr, "0", { enumerable: true, get: () => 2 });
      expect(trySnapshot(getterArr)).toEqual({ ok: false, reason: "accessor" });
      const shared = { a: 1 };
      expect(trySnapshot({ x: shared, y: shared }).ok).toBe(true); // shared, not cyclic
    });

    it("nullObject has no prototype", () => {
      const o = nullObject<number>();
      o.__proto__ = 1;
      expect(Object.getPrototypeOf(o)).toBeNull();
      expect(Object.keys(o)).toEqual(["__proto__"]);
    });
  });
});

// ---------------------------------------------------------------- F2
describe("F2: sparse arrays are validated index by index", () => {
  // eslint-disable-next-line no-sparse-arrays
  const holey = <T>(a: T, b: T): T[] => [a, , b] as T[];

  it("probe: a hole in userExclusions no longer slips through", () => {
    const r = validatePreferences({ ...defaultPreferences(), userExclusions: holey("a.com", "b.com") });
    expect(errorsOf(r)).toEqual(["prefs.userExclusions[1]:hole"]);
    expect(parsePreferences({ ...defaultPreferences(), userExclusions: holey("a.com", "b.com") }).resetFields).toEqual([
      "userExclusions",
    ]);
  });

  it("holes in allowedHosts, keywords and pauses are rejected", () => {
    const s = activeState();
    const pause = { from: 2_000, to: 3_000, kind: "pause" };
    for (const [key, value] of [
      ["allowedHosts", holey("a.com", "b.com")],
      ["keywords", holey("k1", "k2")],
      ["pauses", holey(pause, pause)],
    ] as const) {
      expect(errorsOf(validateActiveState({ ...s, session: { ...s.session, [key]: value } }))).toEqual([
        `active.session.${key}[1]:hole`,
      ]);
    }
  });

  it("through a JSON round-trip (like chrome.storage) a hole becomes null and is still rejected", async () => {
    const local = jsonKv();
    await local.set(KEY_PREFS, { ...defaultPreferences(), userExclusions: holey("a.com", "b.com") });
    expect(local.raw(KEY_PREFS)).toContain('"userExclusions":["a.com",null,"b.com"]');
    const read = await prefsRepo(local).get();
    expect(read.resetFields).toEqual(["userExclusions"]);
    expect(read.prefs.userExclusions).toEqual([]);

    const s = activeState();
    for (const session of [
      { ...s.session, allowedHosts: holey("a.com", "b.com") },
      { ...s.session, keywords: holey("k1", "k2") },
      { ...s.session, pauses: holey({ from: 2_000, kind: "pause" }, { from: 3_000, kind: "pause" }) },
    ]) {
      await local.set(KEY_ACTIVE, { ...s, session });
      expect(await activeRepo(local).get()).toEqual({ corrupt: true });
      expect(await activeRepo(local).put({ ...s, session })).toMatchObject({ ok: false });
    }
    // A valid state survives the round-trip unchanged.
    expect(await activeRepo(local).put(s)).toEqual({ ok: true });
    expect(await activeRepo(local).get()).toEqual({ state: s });
  });
});

// ---------------------------------------------------------------- F3
describe("F3: read-modify-write is serialised per area and key", () => {
  it("probe: 25 parallel overrides.add calls keep all 25", async () => {
    const local = slowKv();
    const repo = overridesRepo(local, diagSink(diagRepo(local, () => 1)));
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => repo.add({ host: `h${i}.example`, createdAt: i })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await repo.list()).map((o) => o.host).sort()).toEqual(
      Array.from({ length: 25 }, (_, i) => `h${i}.example`).sort(),
    );
  });

  it("probe: parallel prefs.update calls on different fields all land", async () => {
    const local = slowKv();
    // Two repo instances on the same area share the queue.
    const a = prefsRepo(local);
    const b = prefsRepo(local);
    await Promise.all([
      a.update({ retentionDays: 7 }),
      b.update({ maxPerHour: 5 }),
      a.update({ defaultMode: "strict" }),
      b.update({ onboardingDone: true }),
    ]);
    expect((await a.get()).prefs).toMatchObject({
      retentionDays: 7,
      maxPerHour: 5,
      defaultMode: "strict",
      onboardingDone: true,
    });
  });

  it("probe: 40 parallel diag appends keep all 40", async () => {
    const local = slowKv();
    const d1 = diagRepo(local, () => 1);
    const d2 = diagRepo(local, () => 2);
    await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? d1 : d2).append(`E_CODE_${i}`)));
    expect((await d1.list()).map((e) => e.code).sort()).toEqual(
      Array.from({ length: 40 }, (_, i) => `E_CODE_${i}`).sort(),
    );
  });

  it("removes and adds interleave safely", async () => {
    const local = slowKv();
    const repo = overridesRepo(local, diagSink(diagRepo(local, () => 1)));
    await repo.add({ host: "keep.example", createdAt: 1 });
    await repo.add({ host: "drop.example", createdAt: 1 });
    await Promise.all([repo.remove("drop.example"), repo.add({ host: "new.example", createdAt: 2 })]);
    expect((await repo.list()).map((o) => o.host).sort()).toEqual(["keep.example", "new.example"]);
  });

  it("a failing holder doesn't block the queue; different keys don't wait", async () => {
    const area = memoryKv();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const first = withKeyLock(area, "k", async () => {
      await gate;
      order.push("first");
      throw new Error("boom");
    });
    const second = withKeyLock(area, "k", () => {
      order.push("second");
      return Promise.resolve(2);
    });
    const other = withKeyLock(area, "other", () => {
      order.push("other");
      return Promise.resolve(3);
    });
    expect(await other).toBe(3);
    expect(isKeyLocked(area, "k")).toBe(true);
    release();
    await expect(first).rejects.toThrow("boom");
    expect(await second).toBe(2);
    expect(order).toEqual(["other", "first", "second"]);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(isKeyLocked(area, "k")).toBe(false);
    expect(isKeyLocked(memoryKv(), "k")).toBe(false);
  });
});

// ---------------------------------------------------------------- F4
describe("F4: record-like maps", () => {
  it.each(["__proto__", "constructor", "prototype"])("rejects the key %s in repeatsByEpisode", (key) => {
    const repeats = JSON.parse(`{"${key}": 1}`) as Record<string, number>;
    const s = activeState();
    expect(errorsOf(validateActiveState({ ...s, policy: { ...s.policy, repeatsByEpisode: repeats } }))).toEqual([
      `active.policy.repeatsByEpisode.${key === "__proto__" ? "?" : key}:invalid_key`,
    ]);
  });

  it("rejects them in summary.responses too, and builds maps with a null prototype", () => {
    const r = sessionRecord();
    const bad = JSON.parse('{"__proto__": 1, "back": 1}') as Record<string, number>;
    expect(validateSessionRecord({ ...r, summary: { ...r.summary, responses: bad } }).ok).toBe(false);
    const good = validateSessionRecord(r);
    expect(good.ok && Object.getPrototypeOf(good.value.summary.responses)).toBeNull();
    const s = activeState();
    const a = validateActiveState({ ...s, policy: { ...s.policy, repeatsByEpisode: { e1: 2 } } });
    expect(a.ok && Object.getPrototypeOf(a.value.policy.repeatsByEpisode)).toBeNull();
    expect(a.ok && a.value.policy.repeatsByEpisode).toEqual({ e1: 2 });
  });
});

// ---------------------------------------------------------------- F5
describe("F5: pruneOlderThan removes invalid session rows and their interventions", () => {
  it("deletes rows failing validation (even ones the endedAt index can't see), counted in diag", async () => {
    const { db, deps, diag } = await idbSetup();
    const repo = sessionsRepo(deps);
    await repo.put(sessionRecord({ id: "good", endedAt: NOW }));
    await putRaw(db, "sessions", [
      { id: "noEnd", title: SECRET },
      { ...sessionRecord({ id: "titled", endedAt: NOW }), title: SECRET },
    ]);
    await interventionsRepo(deps).put(intervention({ sessionId: "titled" }));
    await interventionsRepo(deps).put(intervention({ sessionId: "good", id: "i2" }));
    expect(await repo.pruneOlderThan(cutoff(NOW, 30))).toEqual({
      sessions: 0,
      orphanInterventions: 0,
      invalidSessions: 2,
    });
    const left = await runTx(db, "sessions", "readonly", (tx) => {
      const r = tx.objectStore("sessions").getAllKeys();
      return () => r.result;
    });
    expect(left).toEqual(["good"]);
    expect(await interventionsRepo(deps).listForSession("titled")).toEqual([]);
    expect(await interventionsRepo(deps).listForSession("good")).toHaveLength(1);
    expect((await diag.list()).map((e) => e.code)).toEqual(["E_SESSION_ROW_INVALID", "E_SESSION_ROW_INVALID"]);
    db.close();
  });
});

// ---------------------------------------------------------------- F6
describe("F6: sessions pagination by [endedAt, id]", () => {
  it("equal timestamps across a page boundary are neither skipped nor repeated", async () => {
    const { db, deps } = await idbSetup();
    const repo = sessionsRepo(deps);
    for (const id of ["a", "b", "c", "d", "e"]) await repo.put(sessionRecord({ id, startedAt: 0, endedAt: 500 }));
    await repo.put(sessionRecord({ id: "z", startedAt: 0, endedAt: 400 }));
    await repo.put(sessionRecord({ id: "newest", startedAt: 0, endedAt: 600 }));
    const seen: string[] = [];
    let before: { endedAt: number; id: string } | undefined;
    for (;;) {
      const page = await repo.list({ limit: 2, ...(before !== undefined && { before }) });
      if (page.length === 0) break;
      seen.push(...page.map((s) => s.id));
      const last = page[page.length - 1];
      if (last === undefined) break;
      before = { endedAt: last.endedAt, id: last.id };
    }
    expect(seen).toEqual(["newest", "e", "d", "c", "b", "a", "z"]);
    db.close();
  });
});

// ---------------------------------------------------------------- F7
describe("F7: appending an existing seq", () => {
  it("returns duplicate_seq and leaves the stored row unchanged", async () => {
    const { db, deps } = await idbSetup();
    const repo = segmentsRepo(deps);
    expect(await repo.append(segment({ seq: 0, end: 2_000 }))).toEqual({ ok: true, outcome: "appended" });
    expect(await repo.append(segment({ seq: 0, end: 9_000, host: "other.example" }))).toEqual({
      ok: false,
      errors: ["segment:duplicate_seq"],
    });
    expect(await repo.listForSession("s1")).toEqual([segment({ seq: 0, end: 2_000 })]);
    db.close();
  });

  it("at the cap, a duplicate seq is not used to extend", async () => {
    const { db, deps } = await idbSetup();
    const repo = segmentsRepo(deps, 1);
    await repo.append(segment({ seq: 0, end: 2_000 }));
    expect(await repo.append(segment({ seq: 0, end: 9_000 }))).toEqual({
      ok: false,
      errors: ["segment:duplicate_seq"],
    });
    expect((await repo.listForSession("s1"))[0]?.end).toBe(2_000);
    db.close();
  });

  it("a ConstraintError from add() is mapped to duplicate_seq without aborting", async () => {
    const { db, deps } = await idbSetup();
    const repo = segmentsRepo(deps);
    // Simulate a row that the existence check misses: it is already stored, but
    // getKey() is made to report "absent", so add() itself must catch the collision.
    await putRaw(db, "segments", [segment({ seq: 0 })]);
    vi.spyOn(FakeObjectStore.prototype, "getKey").mockImplementation(function (this: IDBObjectStore) {
      return this.get(["absent", 0]) as IDBRequest<IDBValidKey | undefined>;
    });
    const r = await repo.append(segment({ seq: 0, end: 9_000 }));
    vi.restoreAllMocks();
    expect(r).toEqual({ ok: false, errors: ["segment:duplicate_seq"] });
    db.close();
  });
});

// ---------------------------------------------------------------- F8
describe("F8: schema verified after open", () => {
  async function partialV1(factory: IDBFactory, build: (db: IDBDatabase) => void): Promise<void> {
    const req = factory.open("fb", 1);
    req.onupgradeneeded = () => build(req.result);
    (await request(req)).close();
  }

  it("a v1 database missing an index → safe mode; the raw purge still runs", async () => {
    const factory = freshFactory();
    await partialV1(factory, (db) => {
      db.createObjectStore("segments", { keyPath: ["sessionId", "seq"] }).put(segment());
      db.createObjectStore("interventions", { keyPath: ["sessionId", "id"] }).createIndex("bySession", "sessionId");
      db.createObjectStore("sessions", { keyPath: "id" }).createIndex("byEndedAt", "endedAt");
    });
    const local = memoryKv();
    const r = await openStorage(options({ local, idbFactory: factory }));
    expect(r.mode).toBe("safe");
    expect(r.repos.sessions).toBeNull();
    expect(((await local.get(KEY_DIAG)) as { code: string }[]).map((e) => e.code)).toContain("E_IDB_SCHEMA_MISMATCH");
    const db = await request(factory.open("fb"));
    const n = await runTx(db, "segments", "readonly", (tx) => {
      const c = tx.objectStore("segments").count();
      return () => c.result;
    });
    db.close();
    expect(n).toBe(0);
  });

  it("a v1 database missing the segments store → safe mode, nothing to purge", async () => {
    const factory = freshFactory();
    await partialV1(factory, (db) => {
      db.createObjectStore("sessions", { keyPath: "id" });
    });
    const r = await openStorage(options({ idbFactory: factory }));
    expect(r.mode).toBe("safe");
    expect(r.notices).toEqual([{ code: "safe_mode", at: NOW }]);
  });
});

// ---------------------------------------------------------------- F9
describe("F9: raw purge with an active session keeps only its segments", () => {
  it.each(["normal", "version-less"] as const)("%s path", async (path) => {
    const real = freshFactory();
    const db = await openFb(real);
    await putRaw(
      db,
      "segments",
      ["r", "s", "s0", "s1", "s10", "s2", "t"].flatMap((sessionId) => [
        segment({ sessionId, seq: 0 }),
        segment({ sessionId, seq: 1 }),
      ]),
    );
    db.close();
    const local = memoryKv({ [KEY_ACTIVE]: activeState() }); // session id "s1"
    const factory: IDBFactory =
      path === "normal"
        ? real
        : {
            open: (name: string, version?: number) => {
              if (version !== undefined) throw new DOMException("x", "UnknownError");
              return real.open(name);
            },
            deleteDatabase: (n: string) => real.deleteDatabase(n),
            databases: () => real.databases(),
            cmp: (a: unknown, b: unknown) => real.cmp(a, b),
          };
    const r = await openStorage(options({ local, idbFactory: factory }));
    r.close();
    const check = await request(real.open("fb"));
    const keys = await runTx(check, "segments", "readonly", (tx) => {
      const req = tx.objectStore("segments").getAllKeys();
      return () => req.result;
    });
    check.close();
    expect(keys).toEqual([
      ["s1", 0],
      ["s1", 1],
    ]);
  });
});

// ---------------------------------------------------------------- F10
describe("F10: meta decisions", () => {
  async function start(meta: unknown) {
    const local = memoryKv(meta === undefined ? {} : { [KEY_META]: meta });
    const r = await openStorage(options({ local }));
    r.close();
    const codes = (((await local.get(KEY_DIAG)) as { code: string }[] | undefined) ?? []).map((e) => e.code);
    return { mode: r.mode, meta: await local.get(KEY_META), codes };
  }

  it("missing meta → schema 1 written, normal, no repair code", async () => {
    expect(await start(undefined)).toEqual({ mode: "normal", meta: { schemaVersion: 1, installedAt: NOW }, codes: [] });
  });

  it("schemaVersion 1 with another field invalid → repaired (installedAt = now), normal", async () => {
    for (const meta of [
      { schemaVersion: 1, installedAt: "yesterday" },
      { schemaVersion: 1 },
      { schemaVersion: 1, installedAt: 5, extra: true },
      { schemaVersion: 1, installedAt: -1 },
    ]) {
      const r = await start(meta);
      expect(r.mode).toBe("normal");
      expect(r.meta).toEqual({ schemaVersion: 1, installedAt: NOW });
      expect(r.codes).toContain("E_META_REPAIRED");
    }
  });

  it("valid meta is untouched", async () => {
    expect(await start({ schemaVersion: 1, installedAt: 5 })).toEqual({
      mode: "normal",
      meta: { schemaVersion: 1, installedAt: 5 },
      codes: [],
    });
  });

  it("schemaVersion missing → treated as 1 and written", async () => {
    const r = await start({ installedAt: 5 });
    expect(r.mode).toBe("normal");
    expect(r.meta).toEqual({ schemaVersion: 1, installedAt: NOW });
    expect(r.codes).toContain("E_META_REPAIRED");
  });

  it.each([
    ["not a number", { schemaVersion: "1", installedAt: 5 }, "E_META_INVALID"],
    ["null", { schemaVersion: null, installedAt: 5 }, "E_META_INVALID"],
    ["not an integer", { schemaVersion: 1.5, installedAt: 5 }, "E_META_INVALID"],
    ["newer than the code", { schemaVersion: 2, installedAt: 5 }, "E_SCHEMA_NEWER_THAN_BUILD"],
    ["not an object", "junk", "E_META_INVALID"],
  ])("schemaVersion %s → safe mode", async (_, meta, code) => {
    const r = await start(meta);
    expect(r.mode).toBe("safe");
    expect(r.meta).toEqual(meta);
    expect(r.codes).toContain(code);
  });
});

// ---------------------------------------------------------------- F11
describe("F11: mutation survivors", () => {
  it("retention boundary: endedAt === cut-off is kept, one ms earlier is pruned", async () => {
    const { db, deps } = await idbSetup();
    const repo = sessionsRepo(deps);
    const cut = cutoff(NOW, 30);
    await repo.put(sessionRecord({ id: "edge", startedAt: 0, endedAt: cut }));
    await repo.put(sessionRecord({ id: "before", startedAt: 0, endedAt: cut - 1 }));
    expect((await repo.pruneOlderThan(cut)).sessions).toBe(1);
    expect(await repo.get("edge")).not.toBeNull();
    expect(await repo.get("before")).toBeNull();
    db.close();
  });

  it("every KV repository stores the rebuilt value, never the caller's object", async () => {
    const local = recordingKv();
    const activeIn = withHiddenExtras(activeState());
    expect(await activeRepo(local).put(activeIn)).toEqual({ ok: true });
    expect(local.written.get(KEY_ACTIVE)).not.toBe(activeIn);
    expectNoExtras(local.written.get(KEY_ACTIVE));

    const prefsIn = withHiddenExtras(defaultPreferences());
    expect(await prefsRepo(local).put(prefsIn)).toEqual({ ok: true });
    expectNoExtras(local.written.get(KEY_PREFS));
    expect(await prefsRepo(local).update(withHiddenExtras({ retentionDays: 3 }))).toMatchObject({ ok: true });
    expectNoExtras(local.written.get(KEY_PREFS));

    expect(
      await overridesRepo(local, () => Promise.resolve()).add(withHiddenExtras({ host: "a.com", createdAt: 1 })),
    ).toEqual({ ok: true, added: true });
    const overrides = local.written.get(KEY_OVERRIDES) as unknown[];
    expectNoExtras(overrides[0]);

    expect(await metaRepo(local).put(withHiddenExtras({ schemaVersion: 1, installedAt: 1 }))).toEqual({ ok: true });
    expectNoExtras(local.written.get(KEY_META));
  });

  it("every IndexedDB repository writes the rebuilt value", async () => {
    const { db, deps } = await idbSetup();
    // Spies without an implementation call through to the real methods.
    const putSpy = vi.spyOn(FakeObjectStore.prototype, "put");
    const addSpy = vi.spyOn(FakeObjectStore.prototype, "add");
    const inputs = [withHiddenExtras(sessionRecord()), withHiddenExtras(intervention()), withHiddenExtras(segment())];
    expect(await sessionsRepo(deps).put(inputs[0])).toEqual({ ok: true });
    expect(await interventionsRepo(deps).put(inputs[1])).toEqual({ ok: true });
    expect(await segmentsRepo(deps).append(inputs[2])).toMatchObject({ ok: true });
    const captured: unknown[] = [...putSpy.mock.calls, ...addSpy.mock.calls].map((call): unknown => call[0]);
    expect(captured).toHaveLength(3);
    for (const value of captured) {
      expect(inputs).not.toContain(value);
      expectNoExtras(value);
    }
    db.close();
  });
});

// ---------------------------------------------------------------- F12
describe("F12: titleSubstring is a plain word or phrase", () => {
  it.each([
    "https://a.com",
    "a/b",
    "q?x",
    "frag#1",
    "me@mail",
    "line\nbreak",
    "nul\u0000",
    "del\u007f",
    "c1\u0085",
    "tab\t",
  ])("rejects %j", (t) => {
    expect(isSafeTitleSubstring(t)).toBe(false);
    expect(errorsOf(validateOverride({ host: "a.com", titleSubstring: t, createdAt: 1 }))).toEqual([
      "override.titleSubstring:unsafe_characters",
    ]);
  });

  it.each(["Docs", "Q3 plan – draft", "Ünïcödé", "a.b-c_d (1)"])("accepts %j", (t) => {
    expect(validateOverride({ host: "a.com", titleSubstring: t, createdAt: 1 }).ok).toBe(true);
  });
});
