// SW initialisation (D-023, review F2 and F11): boot marker, failing-then-recovering
// storage, storage_error snapshot, retry on the next input, Startup first.
import { describe, expect, it, vi } from "vitest";
import { createBoot, KEY_BOOT, writeBootMarker } from "../../../src/shell/boot";
import type { Engine } from "../../../src/shell/engine/engine";
import { createRouter } from "../../../src/shell/messaging/router";
import { memoryKv } from "../../../src/shell/storage/memoryKv";
import { openStorage, type OpenStorageResult } from "../../../src/shell/storage/openStorage";
import { freshFactory, keyRange } from "../storage/fixtures";
import { engineFor, fakePorts, harness, startDraft, T0 } from "./fakes";

describe("writeBootMarker", () => {
  it("starts at 1 and increments on every evaluation; invalid values restart at 1", async () => {
    const session = memoryKv();
    expect(await writeBootMarker(session, 10)).toEqual({ seq: 1, at: 10 });
    expect(await writeBootMarker(session, 20)).toEqual({ seq: 2, at: 20 });
    expect(await session.get(KEY_BOOT)).toEqual({ seq: 2, at: 20 });
    for (const bad of ["x", { seq: -1 }, { seq: 1.5 }, { seq: "3" }, null]) {
      await session.set(KEY_BOOT, bad);
      expect((await writeBootMarker(session, 30)).seq).toBe(1);
    }
  });
});

async function opened(): Promise<OpenStorageResult> {
  return openStorage({
    local: memoryKv(),
    session: memoryKv(),
    idbFactory: freshFactory(),
    now: () => T0,
    idbKeyRange: keyRange,
  });
}

describe("createBoot", () => {
  it("failing then recovering storage: storage_error snapshot + diag, then retried by the next input", async () => {
    const ports = fakePorts();
    const recordDiag = vi.fn(() => Promise.resolve());
    const good = await opened();
    const init = vi
      .fn<() => Promise<OpenStorageResult>>()
      .mockRejectedValueOnce(new Error("idb broken"))
      .mockResolvedValue(good);
    const h = await harness();
    const makeEngine = vi.fn(() => engineFor(h, ports));
    const boot = createBoot({ init, makeEngine, snapshot: ports.snapshot, recordDiag, now: () => T0 });

    await expect(boot.engine()).rejects.toThrow("E_BOOT_FAILED");
    expect(ports.snapshot.published).toEqual([
      { v: 1, at: T0, session: null, notices: [{ code: "storage_error", at: T0 }] },
    ]);
    expect(recordDiag).toHaveBeenCalledWith("E_BOOT_FAILED");
    expect(makeEngine).not.toHaveBeenCalled();

    // Commands meanwhile reply storage_error, never internal.
    const router = createRouter({
      runtimeId: "x".repeat(32),
      getURL: (p) => `chrome-extension://${"x".repeat(32)}/${p}`,
      engine: () => boot.engine(),
    });
    const sender = { id: "x".repeat(32), url: `chrome-extension://${"x".repeat(32)}/sidepanel.html` };
    // This call is the retry: it now succeeds.
    const r = await router.handle({ v: 1, id: "a", type: "session.start", payload: startDraft }, sender);
    expect(r).toEqual({ id: "a", ok: true, data: { sessionId: "sess1" } });
    expect(init).toHaveBeenCalledTimes(2);
    expect(makeEngine).toHaveBeenCalledTimes(1);
    // Startup ran first: its snapshot came before the session.start one.
    expect(ports.log.indexOf("snapshot")).toBeLessThan(ports.log.indexOf("notify.create:fb.start.sess1"));
    // Once ready, the engine is reused.
    const e1 = await boot.engine();
    expect(await boot.engine()).toBe(e1);
    expect(init).toHaveBeenCalledTimes(2);
  });

  it("commands reply storage_error while storage stays broken; failure side effects never throw", async () => {
    const ports = fakePorts();
    ports.broken = true;
    const boot = createBoot({
      init: () => Promise.reject(new Error("x")),
      makeEngine: () => ({}) as Engine,
      snapshot: ports.snapshot,
      recordDiag: () => Promise.reject(new Error("y")),
      now: () => T0,
    });
    const id = "y".repeat(32);
    const router = createRouter({
      runtimeId: id,
      getURL: (p) => `chrome-extension://${id}/${p}`,
      engine: () => boot.engine(),
    });
    const sender = { id, url: `chrome-extension://${id}/options.html` };
    expect(await router.handle({ v: 1, id: "a", type: "session.pause", payload: {} }, sender)).toEqual({
      id: "a",
      ok: false,
      error: "storage_error",
    });
    expect(await router.handle({ v: 1, id: "b", type: "prefs.get", payload: {} }, sender)).toEqual({
      id: "b",
      ok: false,
      error: "storage_error",
    });
  });

  it("concurrent callers share one init attempt; safe mode still boots the engine", async () => {
    const ports = fakePorts();
    const h = await harness();
    const safe = { ...(await opened()), mode: "safe" as const, notices: [{ code: "safe_mode" as const, at: T0 }] };
    let release: (v: OpenStorageResult) => void = () => undefined;
    const init = vi.fn(() => new Promise<OpenStorageResult>((r) => (release = r)));
    const boot = createBoot({
      init,
      makeEngine: (o) => engineFor(h, ports, { notices: o.notices }),
      snapshot: ports.snapshot,
      recordDiag: () => Promise.resolve(),
      now: () => T0,
    });
    const a = boot.engine();
    const b = boot.engine();
    release(safe);
    expect(await a).toBe(await b);
    expect(init).toHaveBeenCalledTimes(1);
    await (await a).run(() => Promise.resolve());
    expect(ports.snapshot.published.at(-1)?.notices).toEqual([{ code: "safe_mode", at: T0 }]);
  });
});
