// KvArea adapters and the in-memory test double (DATA_MODEL §8).
import { afterEach, describe, expect, it, vi } from "vitest";
import { chromeLocalArea, chromeSessionArea, type KvArea } from "../../../src/shell/storage/kv";
import { memoryKv } from "../../../src/shell/storage/memoryKv";

describe("memoryKv", () => {
  it("get/set/remove/clear", async () => {
    const kv = memoryKv({ a: 1 });
    expect(await kv.get("a")).toBe(1);
    expect(await kv.get("missing")).toBeUndefined();
    await kv.set("b", { x: [1] });
    expect(kv.keys().sort()).toEqual(["a", "b"]);
    await kv.remove("a");
    expect(kv.keys()).toEqual(["b"]);
    await kv.clear();
    expect(kv.keys()).toEqual([]);
  });

  it("clones on set: later mutation of the caller's object does not change storage", async () => {
    const kv = memoryKv();
    const value = { list: [1, 2], nested: { n: 1 } };
    await kv.set("k", value);
    value.list.push(3);
    value.nested.n = 99;
    expect(await kv.get("k")).toEqual({ list: [1, 2], nested: { n: 1 } });
  });

  it("clones on get: mutating a read value does not change storage", async () => {
    const kv = memoryKv({ k: { list: [1] } });
    const read = (await kv.get("k")) as { list: number[] };
    read.list.push(2);
    expect(await kv.get("k")).toEqual({ list: [1] });
    expect(await kv.get("k")).not.toBe(await kv.get("k"));
  });

  it("clones initial values and rejects uncloneable ones, like chrome.storage", async () => {
    const init = { k: { n: 1 } };
    const kv = memoryKv(init);
    init.k.n = 2;
    expect(await kv.get("k")).toEqual({ n: 1 });
    expect(() => kv.set("f", () => 1)).toThrow();
  });
});

type Area = {
  get: (k: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (k: string) => Promise<void>;
  clear: () => Promise<void>;
};

function fakeArea(): { area: Area; data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const area: Area = {
    get: vi.fn((k: string) => Promise.resolve(data.has(k) ? { [k]: data.get(k) } : {})),
    set: vi.fn((items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
      return Promise.resolve();
    }),
    remove: vi.fn((k: string) => {
      data.delete(k);
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      data.clear();
      return Promise.resolve();
    }),
  };
  return { area, data };
}

describe("chrome adapters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["local", chromeLocalArea],
    ["session", chromeSessionArea],
  ] as const)("%s area maps onto chrome.storage.%s", async (name, make) => {
    const local = fakeArea();
    const session = fakeArea();
    vi.stubGlobal("chrome", { storage: { local: local.area, session: session.area } });
    const used = name === "local" ? local : session;
    const other = name === "local" ? session : local;
    const kv: KvArea = make();
    await kv.set("prefs", { a: 1 });
    expect(used.area.set).toHaveBeenCalledWith({ prefs: { a: 1 } });
    expect(await kv.get("prefs")).toEqual({ a: 1 });
    expect(await kv.get("nope")).toBeUndefined();
    await kv.remove("prefs");
    expect(used.data.has("prefs")).toBe(false);
    await kv.set("x", 1);
    await kv.clear();
    expect(used.area.clear).toHaveBeenCalled();
    expect(used.data.size).toBe(0);
    expect(other.area.set).not.toHaveBeenCalled();
  });
});
