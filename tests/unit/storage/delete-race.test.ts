// Re-review of eecdec4: N1 (deletion vs in-flight writes), N2 (locks keyed by area
// name), N3 (format characters in titleSubstring).
import { describe, expect, it } from "vitest";
import { defaultPreferences } from "../../../src/core/storage/defaults";
import { isSafeTitleSubstring, validateOverride } from "../../../src/core/storage/validate";
import { deleteAllStorage } from "../../../src/shell/storage/deleteAll";
import { chromeLocalArea, chromeSessionArea, type KvArea } from "../../../src/shell/storage/kv";
import { areaEpoch, STORAGE_DELETED, withAreaExclusive, withKeyLock } from "../../../src/shell/storage/kvLock";
import {
  diagRepo,
  diagSink,
  KEY_OVERRIDES,
  KEY_PREFS,
  overridesRepo,
  prefsRepo,
} from "../../../src/shell/storage/kvRepos";
import { memoryKv, type MemoryKv } from "../../../src/shell/storage/memoryKv";
import { freshFactory } from "./fixtures";

type Gate = { wait: Promise<void>; open: () => void };
function gate(): Gate {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** Wraps an area so that the next call of `method` for `key` waits for the gate. */
function gated(inner: MemoryKv, method: "get" | "clear", g: Gate, key?: string): MemoryKv {
  let armed = true;
  return {
    ...inner,
    get: async (k) => {
      if (method === "get" && armed && k === key) {
        armed = false;
        await g.wait;
      }
      return inner.get(k);
    },
    clear: async () => {
      if (method === "clear" && armed) {
        armed = false;
        await g.wait;
      }
      return inner.clear();
    },
  };
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1_000 && !cond(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(cond()).toBe(true);
}

const repoOn = (area: KvArea) => overridesRepo(area, diagSink(diagRepo(area, () => 1)));

function deleteAll(local: KvArea, keepPrefs = false) {
  return deleteAllStorage({
    local,
    session: memoryKv(),
    idbFactory: freshFactory(),
    closeFns: [],
    keepPrefs,
    ...(keepPrefs && { prefs: defaultPreferences() }),
  });
}

describe("N1: deleteAll vs in-flight and queued writes", () => {
  it("(a) reviewer's race: an add stalled in get() can't write back after deleteAll", async () => {
    const inner = memoryKv();
    const g = gate();
    const local = gated(inner, "get", g, KEY_OVERRIDES);
    const before = areaEpoch(local);
    const add = repoOn(local).add({ host: "secret.com", titleSubstring: "Diagnosis", createdAt: 1 });
    const del = deleteAll(local);
    await until(() => areaEpoch(local) > before); // deletion has reached step 5
    g.open(); // the stalled add resumes
    await expect(add).rejects.toMatchObject({ code: STORAGE_DELETED });
    expect(await del).toEqual({ failed: [] });
    expect(await inner.get(KEY_OVERRIDES)).toBeUndefined();
    expect(inner.keys()).toEqual([]);
  });

  it("(b) writes queued while the deletion runs are refused", async () => {
    const inner = memoryKv({ [KEY_PREFS]: { ...defaultPreferences(), retentionDays: 9 } });
    const g = gate();
    const local = gated(inner, "clear", g);
    const before = areaEpoch(local);
    const del = deleteAll(local, true);
    await until(() => areaEpoch(local) > before); // exclusive held, clear() stalled
    const update = prefsRepo(local).update({ retentionDays: 1 });
    const add = repoOn(local).add({ host: "late.com", createdAt: 2 });
    g.open();
    expect(await del).toEqual({ failed: [] });
    await expect(update).rejects.toMatchObject({ code: STORAGE_DELETED });
    await expect(add).rejects.toMatchObject({ code: STORAGE_DELETED });
    expect(inner.keys()).toEqual([KEY_PREFS]);
    expect(await inner.get(KEY_PREFS)).toEqual(defaultPreferences()); // the kept prefs, not the late update
  });

  it("(c) writes after the deletion work normally", async () => {
    const local = memoryKv({ [KEY_OVERRIDES]: [{ host: "old.com", createdAt: 1 }] });
    expect(await deleteAll(local)).toEqual({ failed: [] });
    expect(await repoOn(local).add({ host: "new.com", createdAt: 2 })).toEqual({ ok: true, added: true });
    expect(await prefsRepo(local).update({ retentionDays: 3 })).toMatchObject({ ok: true });
    expect(await repoOn(local).list()).toEqual([{ host: "new.com", createdAt: 2 }]);
  });

  it("an exclusive section waits for pending key locks and blocks new ones until it ends", async () => {
    const area = memoryKv();
    const order: string[] = [];
    const g = gate();
    let started = false;
    const held = withKeyLock(area, "k", async (w) => {
      started = true;
      await g.wait;
      order.push("held");
      await w.set(1); // refused: the epoch moved on while it was waiting
    });
    await until(() => started); // in flight before the exclusive section starts
    const notStarted = withKeyLock(area, "k", () => {
      order.push("never");
      return Promise.resolve();
    });
    const exclusive = withAreaExclusive(area, () => {
      order.push("exclusive");
      return Promise.resolve("done");
    });
    const late = withKeyLock(area, "other", () => {
      order.push("late");
      return Promise.resolve();
    });
    g.open();
    await expect(held).rejects.toMatchObject({ code: STORAGE_DELETED });
    await expect(notStarted).rejects.toMatchObject({ code: STORAGE_DELETED }); // queued before: stale, never runs
    expect(await exclusive).toBe("done");
    await expect(late).rejects.toMatchObject({ code: STORAGE_DELETED }); // queued during: stale
    expect(order).toEqual(["held", "exclusive"]);
    // A failing exclusive section still releases the area.
    await expect(withAreaExclusive(area, () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await withKeyLock(area, "k", async (w) => (await w.remove(), "ok"))).toBe("ok");
  });
});

describe("N2: locks are keyed by area name", () => {
  it("chrome areas are singletons with fixed names", () => {
    expect(chromeLocalArea()).toBe(chromeLocalArea());
    expect(chromeSessionArea()).toBe(chromeSessionArea());
    expect(chromeLocalArea().name).toBe("chrome.storage.local");
    expect(chromeSessionArea().name).toBe("chrome.storage.session");
  });

  it("two area objects with the same name share one queue (no lost updates)", async () => {
    const backend = memoryKv({}, "shared-backend");
    const slow = (): KvArea => {
      const later = <T>(fn: () => Promise<T>): Promise<T> =>
        new Promise((resolve, reject) => setTimeout(() => void fn().then(resolve, reject), Math.random() * 3));
      return {
        name: "shared-backend",
        get: (k) => later(() => backend.get(k)),
        set: (k, v) => later(() => backend.set(k, v)),
        remove: (k) => later(() => backend.remove(k)),
        clear: () => later(() => backend.clear()),
      };
    };
    const a = repoOn(slow());
    const b = repoOn(slow());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? a : b).add({ host: `h${i}.example`, createdAt: i })),
    );
    expect(((await backend.get(KEY_OVERRIDES)) as unknown[]).length).toBe(20);
  });

  it("memory areas get unique names unless one is given", () => {
    expect(memoryKv().name).not.toBe(memoryKv().name);
    expect(memoryKv({}, "x").name).toBe("x");
  });
});

describe("N3: titleSubstring rejects invisible format characters and separators", () => {
  it.each([
    ["zero-width space U+200B", "Doc​s"],
    ["right-to-left override U+202E", "‮txt.exe"],
    ["byte-order mark U+FEFF", "﻿Docs"],
    ["soft hyphen U+00AD", "Do­cs"],
    ["line separator U+2028", "a b"],
    ["paragraph separator U+2029", "a b"],
  ])("rejects %s", (_, t) => {
    expect(isSafeTitleSubstring(t)).toBe(false);
    expect(validateOverride({ host: "a.com", titleSubstring: t, createdAt: 1 }).ok).toBe(false);
  });

  it("still accepts ordinary text, including non-ASCII letters and spaces", () => {
    expect(isSafeTitleSubstring("Q3 plan – Ünïcödé draft")).toBe(true);
  });
});
