// IndexedDB `fb` v1 schema, helpers, connection lifecycle and deletion (DATA_MODEL §6, §7).
import { describe, expect, it, vi } from "vitest";
import {
  deleteFbDatabase,
  errorCode,
  FB_DB_NAME,
  openFb,
  openFbExisting,
  request,
  runTx,
  StorageError,
  upgradeFb,
} from "../../../src/shell/storage/idb";
import { freshFactory } from "./fixtures";

function rawOpen(factory: IDBFactory, version?: number): Promise<IDBDatabase> {
  return request(version === undefined ? factory.open(FB_DB_NAME) : factory.open(FB_DB_NAME, version));
}

async function dbNames(factory: IDBFactory): Promise<string[]> {
  return (await factory.databases()).map((d) => d.name ?? "");
}

describe("openFb", () => {
  it("creates version 1 with the §7 stores, key paths and indexes", async () => {
    const db = await openFb(freshFactory());
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(["interventions", "segments", "sessions"]);
    const tx = db.transaction(["segments", "interventions", "sessions"]);
    expect(tx.objectStore("segments").keyPath).toEqual(["sessionId", "seq"]);
    expect([...tx.objectStore("segments").indexNames]).toEqual([]);
    expect(tx.objectStore("interventions").keyPath).toEqual(["sessionId", "id"]);
    expect(tx.objectStore("interventions").index("bySession").keyPath).toBe("sessionId");
    expect(tx.objectStore("sessions").keyPath).toBe("id");
    expect(tx.objectStore("sessions").index("byEndedAt").keyPath).toBe("endedAt");
    db.close();
  });

  it("re-opens an existing database without upgrading again", async () => {
    const factory = freshFactory();
    (await openFb(factory)).close();
    const db = await openFb(factory);
    expect(db.version).toBe(1);
    db.close();
  });

  it("upgradeFb is idempotent and a no-op from version ≥ 1", async () => {
    const db = await openFb(freshFactory());
    const spy = vi.spyOn(db, "createObjectStore");
    upgradeFb(db, 1);
    upgradeFb(db, 0); // every store already exists: nothing to create
    expect(spy).not.toHaveBeenCalled();
    db.close();
  });

  it("aborts the upgrade when creating stores throws", async () => {
    const factory = freshFactory();
    const open = factory.open.bind(factory);
    vi.spyOn(factory, "open").mockImplementation((name: string, version?: number) => {
      const req = open(name, version);
      // Make store creation inside upgradeFb throw.
      req.addEventListener("upgradeneeded", () => {
        const db = req.result;
        db.createObjectStore = () => {
          throw new DOMException("nope", "UnknownError");
        };
      });
      return req;
    });
    await expect(openFb(factory)).rejects.toMatchObject({ code: "E_IDB_OPEN" });
  });

  it("rejects with a code when open throws or errors", async () => {
    const throwing = {
      open: () => {
        throw new Error("no IDB");
      },
    } as unknown as IDBFactory;
    await expect(openFb(throwing)).rejects.toMatchObject({ code: "E_IDB_OPEN_THROW" });
    const factory = freshFactory();
    (await rawOpen(factory, 3)).close(); // a newer schema → VersionError on open(…, 1)
    await expect(openFb(factory)).rejects.toMatchObject({ code: "E_IDB_OPEN" });
  });

  it("closes itself on versionchange so a deletion elsewhere is not blocked", async () => {
    const factory = freshFactory();
    const onClose = vi.fn();
    const db = await openFb(factory, { onVersionChangeClose: onClose });
    await request(factory.deleteDatabase(FB_DB_NAME));
    expect(onClose).toHaveBeenCalledOnce();
    expect(() => db.transaction("segments")).toThrow();
  });

  it("rejects when blocked and closes a connection that arrives later", async () => {
    const factory = freshFactory();
    // An old connection (version 0 → 1 created by a raw open, no versionchange handler)
    // can't block a v1 open; simulate blocked by holding a v1 connection and asking for v1
    // through a factory whose open() requests a higher version.
    const holder = await rawOpen(factory, 1);
    const open = factory.open.bind(factory);
    let late: IDBOpenDBRequest | undefined;
    vi.spyOn(factory, "open").mockImplementation((name: string) => {
      late = open(name, 2);
      return late;
    });
    await expect(openFb(factory)).rejects.toMatchObject({ code: "E_IDB_OPEN_BLOCKED" });
    holder.close(); // now the blocked open proceeds…
    await new Promise<void>((resolve) => late?.addEventListener("success", () => resolve()));
    // …and openFb closed it immediately, so a deletion is not blocked.
    const del = factory.deleteDatabase(FB_DB_NAME);
    const blocked = vi.fn();
    del.onblocked = blocked;
    await request(del);
    expect(blocked).not.toHaveBeenCalled();
  });
});

describe("openFbExisting (version-less)", () => {
  it("resolves null and creates nothing when there is no database", async () => {
    const factory = freshFactory();
    expect(await openFbExisting(factory)).toBeNull();
    expect(await dbNames(factory)).toEqual([]);
    // A later versioned open still gets a proper upgrade.
    const db = await openFb(factory);
    expect(db.objectStoreNames.contains("segments")).toBe(true);
    db.close();
  });

  it("opens whatever version exists", async () => {
    const factory = freshFactory();
    (await rawOpen(factory, 4)).close();
    const db = await openFbExisting(factory);
    expect(db?.version).toBe(4);
    db?.close();
  });

  it("rejects when open throws", async () => {
    const throwing = {
      open: () => {
        throw new Error("x");
      },
    } as unknown as IDBFactory;
    await expect(openFbExisting(throwing)).rejects.toMatchObject({ code: "E_IDB_OPEN_THROW" });
  });
});

describe("runTx and request", () => {
  it("resolves after commit with the body's outcome", async () => {
    const db = await openFb(freshFactory());
    const n = await runTx(db, "sessions", "readwrite", (tx) => {
      tx.objectStore("sessions").put({ id: "a", endedAt: 1 });
      const c = tx.objectStore("sessions").count();
      return () => c.result;
    });
    expect(n).toBe(1);
    db.close();
  });

  it("aborts everything when a request fails", async () => {
    const db = await openFb(freshFactory());
    await expect(
      runTx(db, "sessions", "readwrite", (tx) => {
        const s = tx.objectStore("sessions");
        s.put({ id: "a", endedAt: 1 });
        s.add({ id: "a", endedAt: 2 }); // ConstraintError
        return () => undefined;
      }),
    ).rejects.toMatchObject({ code: "E_IDB_TX_ABORT" });
    const n = await runTx(db, "sessions", "readonly", (tx) => {
      const c = tx.objectStore("sessions").count();
      return () => c.result;
    });
    expect(n).toBe(0);
    db.close();
  });

  it("maps body, read and transaction-open failures to codes", async () => {
    const db = await openFb(freshFactory());
    await expect(
      runTx(db, "sessions", "readwrite", () => {
        throw new Error("body");
      }),
    ).rejects.toMatchObject({ code: "E_IDB_TX_BODY" });
    await expect(
      runTx(db, "sessions", "readonly", () => () => {
        throw new Error("read");
      }),
    ).rejects.toMatchObject({ code: "E_IDB_TX_READ" });
    await expect(runTx(db, "nope", "readonly", () => () => 1)).rejects.toMatchObject({ code: "E_IDB_TX_OPEN" });
    db.close();
  });

  it("request() rejects with its code", async () => {
    const db = await openFb(freshFactory());
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put({ id: "a", endedAt: 1 });
    const p = request(tx.objectStore("sessions").add({ id: "a", endedAt: 1 }), "E_ADD");
    tx.onabort = () => undefined;
    await expect(p).rejects.toMatchObject({ code: "E_ADD" });
    db.close();
  });

  it("errorCode keeps StorageError codes only", () => {
    expect(errorCode(new StorageError("E_X1"), "E_FALLBACK")).toBe("E_X1");
    expect(errorCode(new Error("https://leak"), "E_FALLBACK")).toBe("E_FALLBACK");
    expect(new StorageError("E_X1").name).toBe("StorageError");
  });
});

describe("deleteFbDatabase (§6 step 4)", () => {
  it("closes our connection first, then deletes", async () => {
    const factory = freshFactory();
    const db = await openFb(factory);
    const close = vi.fn(() => db.close());
    expect(await deleteFbDatabase(factory, [close])).toEqual({ blocked: false });
    expect(close).toHaveBeenCalledOnce();
    expect(await dbNames(factory)).toEqual([]);
  });

  it("onblocked: closes connections again and the deletion completes", async () => {
    const factory = freshFactory();
    // A connection without a versionchange handler that only closes on the second request.
    const held = await rawOpen(factory, 1);
    let calls = 0;
    const close = vi.fn(() => {
      calls += 1;
      if (calls >= 2) held.close();
    });
    expect(await deleteFbDatabase(factory, [close])).toEqual({ blocked: true });
    expect(close).toHaveBeenCalledTimes(2);
    expect(await dbNames(factory)).toEqual([]);
  });

  it("rejects after the timeout if a connection never closes", async () => {
    const factory = freshFactory();
    const held = await rawOpen(factory, 1);
    await expect(deleteFbDatabase(factory, [], { blockedTimeoutMs: 20 })).rejects.toMatchObject({
      code: "E_IDB_DELETE_BLOCKED",
    });
    held.close();
  });

  it("ignores close functions that throw, and maps a throwing factory", async () => {
    const factory = freshFactory();
    (await rawOpen(factory, 1)).close();
    const bad = vi.fn(() => {
      throw new Error("already closed");
    });
    expect(await deleteFbDatabase(factory, [bad])).toEqual({ blocked: false });
    const throwing = {
      deleteDatabase: () => {
        throw new Error("x");
      },
    } as unknown as IDBFactory;
    await expect(deleteFbDatabase(throwing, [])).rejects.toMatchObject({ code: "E_IDB_DELETE_THROW" });
  });

  it("maps a failing deletion request", async () => {
    const failing = {
      deleteDatabase: () => {
        const req = {} as IDBOpenDBRequest;
        queueMicrotask(() => {
          req.onerror?.call(req, { preventDefault: () => undefined } as Event);
        });
        return req;
      },
    } as unknown as IDBFactory;
    await expect(deleteFbDatabase(failing, [])).rejects.toMatchObject({ code: "E_IDB_DELETE" });
  });
});
