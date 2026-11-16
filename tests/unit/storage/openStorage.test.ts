// Start-up order, raw purge, safe mode and retention (DATA_MODEL §3, §5, §8), and
// "Delete all data" steps 4–6 (§6).
import { describe, expect, it, vi } from "vitest";
import { defaultPreferences } from "../../../src/core/storage/defaults";
import { DAY_MS } from "../../../src/core/storage/retention";
import type { Migration } from "../../../src/core/storage/migrations";
import { deleteAllStorage, KEY_UI_SNAPSHOT } from "../../../src/shell/storage/deleteAll";
import { FB_DB_NAME, openFb, request, runTx } from "../../../src/shell/storage/idb";
import { KEY_ACTIVE, KEY_DIAG, KEY_META, KEY_OVERRIDES, KEY_PREFS } from "../../../src/shell/storage/kvRepos";
import type { KvArea } from "../../../src/shell/storage/kv";
import { memoryKv, type MemoryKv } from "../../../src/shell/storage/memoryKv";
import { openStorage, type OpenStorageOptions } from "../../../src/shell/storage/openStorage";
import { activeState, freshFactory, intervention, keyRange, segment, sessionRecord } from "./fixtures";

const NOW = 100 * DAY_MS;

function options(over: Partial<OpenStorageOptions> & { local?: KvArea } = {}): OpenStorageOptions {
  return {
    local: memoryKv(),
    session: memoryKv(),
    idbFactory: freshFactory(),
    now: () => NOW,
    idbKeyRange: keyRange,
    ...over,
  };
}

/** Seeds `fb` directly (bypassing repositories) and closes the connection. */
async function seedIdb(
  factory: IDBFactory,
  rows: { segments?: unknown[]; sessions?: unknown[]; interventions?: unknown[] },
) {
  const db = await openFb(factory);
  await runTx(db, ["segments", "sessions", "interventions"], "readwrite", (tx) => {
    for (const r of rows.segments ?? []) tx.objectStore("segments").put(r);
    for (const r of rows.sessions ?? []) tx.objectStore("sessions").put(r);
    for (const r of rows.interventions ?? []) tx.objectStore("interventions").put(r);
    return () => undefined;
  });
  db.close();
}

async function countRaw(factory: IDBFactory, store: string): Promise<number> {
  const db = await request(factory.open(FB_DB_NAME));
  try {
    if (!db.objectStoreNames.contains(store)) return -1;
    return await runTx(db, store, "readonly", (tx) => {
      const c = tx.objectStore(store).count();
      return () => c.result;
    });
  } finally {
    db.close();
  }
}

/** A factory whose versioned open() throws, like a broken or downgraded IndexedDB. */
function failingVersionedOpen(real: IDBFactory, versionless: "delegate" | "throw" = "delegate"): IDBFactory {
  return {
    open: (name: string, version?: number) => {
      if (version !== undefined || versionless === "throw") throw new DOMException("broken", "UnknownError");
      return real.open(name);
    },
    deleteDatabase: (name: string) => real.deleteDatabase(name),
    databases: () => real.databases(),
    cmp: (a: unknown, b: unknown) => real.cmp(a, b),
  };
}

const failingMigration: Migration = {
  from: 0,
  to: 1,
  migrate: () => {
    throw new Error("bad data");
  },
};

async function diagCodes(local: KvArea): Promise<string[]> {
  const log = (await local.get(KEY_DIAG)) as { code: string }[] | undefined;
  return (log ?? []).map((e) => e.code);
}

describe("openStorage: normal start", () => {
  it("fresh install: normal mode, no notices, meta written, all repositories", async () => {
    const local = memoryKv();
    const r = await openStorage(options({ local }));
    expect(r.mode).toBe("normal");
    expect(r.notices).toEqual([]);
    expect(await local.get(KEY_META)).toEqual({ schemaVersion: 1, installedAt: NOW });
    expect(r.repos.segments).not.toBeNull();
    expect(r.repos.sessions).not.toBeNull();
    expect(r.repos.interventions).not.toBeNull();
    expect(await r.repos.prefs.get()).toEqual({ prefs: defaultPreferences(), resetFields: [] });
    r.close();
  });

  it("keeps a valid meta untouched and repairs an incomplete one", async () => {
    const local = memoryKv({ [KEY_META]: { schemaVersion: 1, installedAt: 5 } });
    (await openStorage(options({ local }))).close();
    expect(await local.get(KEY_META)).toEqual({ schemaVersion: 1, installedAt: 5 });
    const broken = memoryKv({ [KEY_META]: { schemaVersion: 1, installedAt: "yesterday" } });
    (await openStorage(options({ local: broken }))).close();
    expect(await broken.get(KEY_META)).toEqual({ schemaVersion: 1, installedAt: NOW });
  });

  it("invariant 3: no session ⇒ segments empty after start-up", async () => {
    const factory = freshFactory();
    await seedIdb(factory, { segments: [segment({ seq: 0 }), segment({ seq: 1 }), segment({ sessionId: "s9" })] });
    const local = memoryKv();
    const r = await openStorage(options({ local, idbFactory: factory }));
    expect(await local.get(KEY_ACTIVE)).toBeUndefined();
    expect(await r.repos.segments?.count("s1")).toBe(0);
    r.close();
    expect(await countRaw(factory, "segments")).toBe(0);
  });

  it("keeps segments while a valid session is active", async () => {
    const factory = freshFactory();
    await seedIdb(factory, { segments: [segment({ seq: 0 }), segment({ seq: 1 })] });
    const local = memoryKv({ [KEY_ACTIVE]: activeState() });
    const r = await openStorage(options({ local, idbFactory: factory }));
    expect(await r.repos.segments?.count("s1")).toBe(2);
    expect(await r.repos.active.get()).toEqual({ state: activeState() });
    r.close();
  });

  it("corrupt session.active → {corrupt} and the raw purge runs", async () => {
    const factory = freshFactory();
    await seedIdb(factory, { segments: [segment()] });
    const local = memoryKv({ [KEY_ACTIVE]: { ...activeState(), title: "Inbox (3)" } });
    const r = await openStorage(options({ local, idbFactory: factory }));
    expect(await r.repos.active.get()).toEqual({ corrupt: true });
    expect(r.mode).toBe("normal");
    r.close();
    expect(await countRaw(factory, "segments")).toBe(0);
  });

  it("retention pruning uses prefs.retentionDays", async () => {
    const factory = freshFactory();
    await seedIdb(factory, {
      sessions: [
        sessionRecord({ id: "old", startedAt: 0, endedAt: NOW - 8 * DAY_MS }),
        sessionRecord({ id: "recent", startedAt: 0, endedAt: NOW - 6 * DAY_MS }),
      ],
      interventions: [intervention({ sessionId: "old" }), intervention({ sessionId: "recent", id: "i2" })],
    });
    const local = memoryKv({ [KEY_PREFS]: { ...defaultPreferences(), retentionDays: 7 } });
    const r = await openStorage(options({ local, idbFactory: factory }));
    expect((await r.repos.sessions?.list())?.map((s) => s.id)).toEqual(["recent"]);
    expect(await r.repos.interventions?.listForSession("old")).toEqual([]);
    expect(await r.repos.interventions?.listForSession("recent")).toHaveLength(1);
    r.close();
  });

  it("retention 0 keeps nothing at start-up", async () => {
    const factory = freshFactory();
    await seedIdb(factory, {
      sessions: [sessionRecord({ id: "today", endedAt: NOW })],
      interventions: [intervention({ sessionId: "today" })],
    });
    const local = memoryKv({ [KEY_PREFS]: { ...defaultPreferences(), retentionDays: 0 } });
    const r = await openStorage(options({ local, idbFactory: factory }));
    expect(await r.repos.sessions?.list()).toEqual([]);
    r.close();
    expect(await countRaw(factory, "interventions")).toBe(0);
  });

  it("invalid prefs → prefs_reset notice once; repaired prefs are written back (AC-15, §8.1)", async () => {
    const local = memoryKv({
      [KEY_PREFS]: { ...defaultPreferences(), maxPerHour: 60, retentionDays: 3, legacy: true },
    });
    const r = await openStorage(options({ local }));
    expect(r.mode).toBe("normal");
    expect(r.notices).toEqual([{ code: "prefs_reset", at: NOW }]);
    expect(await diagCodes(local)).toContain("E_PREFS_RESET");
    // Stored value is now the repaired one: invalid field defaulted, valid kept, unknown dropped.
    expect(await local.get(KEY_PREFS)).toEqual({ ...defaultPreferences(), retentionDays: 3 });
    expect(await r.repos.prefs.get()).toEqual({
      prefs: { ...defaultPreferences(), retentionDays: 3 },
      resetFields: [],
    });
    r.close();
    // A second start reports no prefs_reset.
    const again = await openStorage(options({ local }));
    expect(again.mode).toBe("normal");
    expect(again.notices).toEqual([]);
    again.close();
  });

  it("safe mode does not write repaired prefs back", async () => {
    const stored = { ...defaultPreferences(), maxPerHour: 60 };
    const local = memoryKv({ [KEY_META]: { schemaVersion: 0, installedAt: 1 }, [KEY_PREFS]: stored });
    const r = await openStorage(options({ local, migrations: [failingMigration] }));
    expect(r.mode).toBe("safe");
    expect(r.notices).toEqual([{ code: "safe_mode", at: NOW }]);
    expect(await local.get(KEY_PREFS)).toEqual(stored);
    r.close();
  });

  it("a successful fixture migration writes the migrated keys, then meta (installedAt kept)", async () => {
    const local = memoryKv({
      [KEY_META]: { schemaVersion: 0, installedAt: 7 },
      [KEY_PREFS]: { ...defaultPreferences(), schemaVersion: 0 },
      [KEY_OVERRIDES]: [{ host: "a.com", createdAt: 1, legacy: true }],
    });
    const migrate: Migration = {
      from: 0,
      to: 1,
      migrate: (d) => {
        const prefs = d[KEY_PREFS];
        const next: Record<string, unknown> = { ...d };
        delete next[KEY_OVERRIDES];
        if (typeof prefs === "object" && prefs !== null) next[KEY_PREFS] = { ...prefs, schemaVersion: 1 };
        return next;
      },
    };
    const r = await openStorage(options({ local, migrations: [migrate] }));
    expect(r.mode).toBe("normal");
    expect(await local.get(KEY_META)).toEqual({ schemaVersion: 1, installedAt: 7 });
    expect(await local.get(KEY_OVERRIDES)).toBeUndefined();
    expect((await r.repos.prefs.get()).resetFields).toEqual([]);
    r.close();
  });
});

describe("openStorage: safe mode", () => {
  it("failing migration → safe mode; raw purge still runs; aggregates are kept", async () => {
    const factory = freshFactory();
    await seedIdb(factory, {
      segments: [segment()],
      sessions: [sessionRecord({ id: "ancient", startedAt: 0, endedAt: 1 })],
    });
    const local = memoryKv({ [KEY_META]: { schemaVersion: 0, installedAt: 1 } });
    const r = await openStorage(options({ local, idbFactory: factory, migrations: [failingMigration] }));
    expect(r.mode).toBe("safe");
    expect(r.notices).toEqual([{ code: "safe_mode", at: NOW }]);
    expect(await diagCodes(local)).toContain("E_MIGRATION_FAILED_0_1");
    expect(await local.get(KEY_META)).toEqual({ schemaVersion: 0, installedAt: 1 });
    r.close();
    expect(await countRaw(factory, "segments")).toBe(0);
    expect(await countRaw(factory, "sessions")).toBe(1);
  });

  it("failing IndexedDB open → safe mode; raw purge through a version-less open", async () => {
    const real = freshFactory();
    await seedIdb(real, { segments: [segment(), segment({ seq: 1 })] });
    const local = memoryKv();
    const r = await openStorage(options({ local, idbFactory: failingVersionedOpen(real) }));
    expect(r.mode).toBe("safe");
    expect(r.notices).toEqual([{ code: "safe_mode", at: NOW }]);
    expect(r.repos.segments).toBeNull();
    expect(r.repos.sessions).toBeNull();
    expect(r.repos.interventions).toBeNull();
    expect(await diagCodes(local)).toContain("E_IDB_OPEN_THROW");
    r.close();
    expect(await countRaw(real, "segments")).toBe(0);
  });

  it("failing migration AND failing IndexedDB open → raw purge still runs", async () => {
    const real = freshFactory();
    await seedIdb(real, { segments: [segment()] });
    const local = memoryKv({ [KEY_META]: { schemaVersion: 0, installedAt: 1 } });
    const r = await openStorage(
      options({ local, idbFactory: failingVersionedOpen(real), migrations: [failingMigration] }),
    );
    expect(r.mode).toBe("safe");
    expect(await countRaw(real, "segments")).toBe(0);
  });

  it("version-less purge creates no database when none exists", async () => {
    const real = freshFactory();
    const r = await openStorage(options({ idbFactory: failingVersionedOpen(real) }));
    expect(r.mode).toBe("safe");
    expect(await real.databases()).toEqual([]);
  });

  it("version-less purge skips a database without a segments store", async () => {
    const real = freshFactory();
    const other = await request(real.open(FB_DB_NAME, 5));
    other.close();
    const r = await openStorage(options({ idbFactory: failingVersionedOpen(real) }));
    expect(r.mode).toBe("safe");
    expect(r.notices).toEqual([{ code: "safe_mode", at: NOW }]);
    expect(await countRaw(real, "segments")).toBe(-1);
  });

  it("a newer IndexedDB schema (downgrade) → safe mode, purge via version-less open", async () => {
    const real = freshFactory();
    const db = await request(
      (() => {
        const req = real.open(FB_DB_NAME, 2);
        req.onupgradeneeded = () => {
          req.result.createObjectStore("segments", { keyPath: ["sessionId", "seq"] }).put(segment());
        };
        return req;
      })(),
    );
    db.close();
    const r = await openStorage(options({ idbFactory: real }));
    expect(r.mode).toBe("safe");
    expect(await countRaw(real, "segments")).toBe(0);
  });

  it("invalid or newer meta → safe mode", async () => {
    for (const meta of [{ schemaVersion: "one" }, "junk", { schemaVersion: 2, installedAt: 1 }]) {
      const local = memoryKv({ [KEY_META]: meta });
      const r = await openStorage(options({ local }));
      expect(r.mode).toBe("safe");
      r.close();
    }
    const local = memoryKv({ [KEY_META]: "junk" });
    (await openStorage(options({ local }))).close();
    expect(await diagCodes(local)).toContain("E_META_INVALID");
  });

  it("storage.local read failure → safe mode, and the raw purge still runs", async () => {
    const factory = freshFactory();
    await seedIdb(factory, { segments: [segment()] });
    const local: MemoryKv = memoryKv({ [KEY_ACTIVE]: activeState() });
    const get = local.get.bind(local);
    local.get = (key) => (key === KEY_DIAG ? get(key) : Promise.reject(new Error("io")));
    const r = await openStorage(options({ local, idbFactory: factory }));
    expect(r.mode).toBe("safe");
    expect(r.notices.map((n) => n.code)).toEqual(["safe_mode", "storage_error"]);
    r.close();
    // The session could not be read, so it can't be trusted to exist: raw data goes.
    expect(await countRaw(factory, "segments")).toBe(0);
    expect(await diagCodes(local)).toEqual(
      expect.arrayContaining(["E_MIGRATION_LOCAL_IO", "E_ACTIVE_READ", "E_RETENTION_PRUNE"]),
    );
  });

  it("raw purge failure → storage_error notice", async () => {
    const real = freshFactory();
    const r = await openStorage(options({ idbFactory: failingVersionedOpen(real, "throw") }));
    expect(r.mode).toBe("safe");
    expect(r.notices.map((n) => n.code)).toEqual(["safe_mode", "storage_error"]);
  });

  it("closes its connection on versionchange so a deletion elsewhere proceeds", async () => {
    const factory = freshFactory();
    const r = await openStorage(options({ idbFactory: factory }));
    await request(factory.deleteDatabase(FB_DB_NAME));
    await expect(r.repos.segments?.count("s1")).rejects.toMatchObject({ code: "E_IDB_TX_OPEN" });
  });
});

describe("deleteAllStorage (§6 steps 4–6)", () => {
  async function populated() {
    const factory = freshFactory();
    const local = memoryKv();
    const session = memoryKv({ [KEY_UI_SNAPSHOT]: { v: 1, at: 1, session: { id: "s1" }, notices: [] } });
    const r = await openStorage(options({ local, session, idbFactory: factory }));
    await r.repos.active.put(activeState());
    await r.repos.prefs.update({ retentionDays: 9 });
    await r.repos.overrides.add({ host: "a.com", titleSubstring: "Docs", createdAt: 1 });
    await r.repos.segments?.append(segment());
    await r.repos.sessions?.put(sessionRecord());
    await r.repos.interventions?.put(intervention());
    await session.set("overlay.pending", { nonce: "n" });
    return { factory, local, session, r };
  }

  it("deletes everything and republishes an empty snapshot", async () => {
    const { factory, local, session, r } = await populated();
    const close = vi.fn(r.close);
    const out = await deleteAllStorage({
      local,
      session,
      idbFactory: factory,
      closeFns: [close],
      keepPrefs: false,
      now: () => 123,
    });
    expect(out).toEqual({ failed: [] });
    expect(close).toHaveBeenCalled();
    expect(await factory.databases()).toEqual([]);
    expect(local.keys()).toEqual([]);
    expect(session.keys()).toEqual([KEY_UI_SNAPSHOT]);
    expect(await session.get(KEY_UI_SNAPSHOT)).toEqual({ v: 1, at: 123, session: null, notices: [] });
    // Next start-up is a clean install with no raw data.
    const again = await openStorage(options({ local, idbFactory: factory }));
    expect(again.mode).toBe("normal");
    expect(await again.repos.segments?.count("s1")).toBe(0);
    expect(await again.repos.sessions?.list()).toEqual([]);
    again.close();
  });

  it("keepPrefs re-writes the preferences only", async () => {
    const { factory, local, session, r } = await populated();
    const { prefs } = await r.repos.prefs.get();
    const out = await deleteAllStorage({
      local,
      session,
      idbFactory: factory,
      closeFns: [r.close],
      keepPrefs: true,
      prefs,
    });
    expect(out).toEqual({ failed: [] });
    expect(local.keys()).toEqual([KEY_PREFS]);
    expect(await local.get(KEY_PREFS)).toMatchObject({ retentionDays: 9 });
  });

  it("keepPrefs with invalid prefs fails that step only", async () => {
    const { factory, local, session, r } = await populated();
    const out = await deleteAllStorage({
      local,
      session,
      idbFactory: factory,
      closeFns: [r.close],
      keepPrefs: true,
      prefs: { ...defaultPreferences(), maxPerHour: 100 },
    });
    expect(out).toEqual({ failed: ["prefs_restore"] });
    expect(local.keys()).toEqual([]);
  });

  it("onblocked: a connection still open is closed by closeFns and the deletion completes", async () => {
    const { factory, local, session, r } = await populated();
    // A second connection without a versionchange handler (e.g. one the SW cached),
    // which only goes away when closeFns run again after `blocked`.
    const held = await request(factory.open(FB_DB_NAME));
    let calls = 0;
    const closeHeld = vi.fn(() => {
      calls += 1;
      if (calls >= 2) held.close();
    });
    const out = await deleteAllStorage({
      local,
      session,
      idbFactory: factory,
      closeFns: [r.close, closeHeld],
      keepPrefs: false,
    });
    expect(out).toEqual({ failed: [] });
    expect(closeHeld).toHaveBeenCalledTimes(2);
    expect(await factory.databases()).toEqual([]);
  });

  it("attempts every step even when earlier ones fail, and lists the failures", async () => {
    const factory = freshFactory();
    const held = await request(factory.open(FB_DB_NAME, 1));
    const local = memoryKv({ [KEY_PREFS]: defaultPreferences() });
    local.clear = () => Promise.reject(new Error("io"));
    const session = memoryKv({ x: 1 });
    session.clear = () => Promise.reject(new Error("io"));
    session.set = () => Promise.reject(new Error("io"));
    const out = await deleteAllStorage({
      local,
      session,
      idbFactory: factory,
      closeFns: [],
      keepPrefs: true,
      prefs: defaultPreferences(),
      blockedTimeoutMs: 20,
    });
    expect(out).toEqual({ failed: ["idb_delete", "local_clear", "session_clear", "snapshot_publish"] });
    held.close();
  });
});
