/**
 * Privacy (PARSER_SPEC principle 3, DATA_MODEL minimisation): the sentence is parsed
 * in memory and never leaves it. Nothing but the capped label and objective can carry
 * the user's words, and `parse.intent` writes nothing: no storage.local key, no
 * storage.session key, no IndexedDB access at all.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { parseIntent } from "../../../src/core/parser";
import { LIMITS } from "../../../src/core/storage/validate";
import { createRouter } from "../../../src/shell/messaging/router";
import { openStorage } from "../../../src/shell/storage/openStorage";
import { memoryKv } from "../../../src/shell/storage/memoryKv";
import type { KvArea } from "../../../src/shell/storage/kv";
import { createEngine } from "../../../src/shell/engine/engine";
import { createFakeClock } from "../../../src/core/clock";
import { keyRange } from "../storage/fixtures";
import { fakePorts, T0 } from "../engine/fakes";
import { ctx } from "./helpers";

const SECRET = "wittgenstein";
const LONG_SENTENCE =
  `I want to finish the ${SECRET} essay on docs.example.com for 2 hours. ` +
  `${"The notes mention the quiet reading room upstairs. ".repeat(8)}` +
  `My mother's phone number is 555 0101 and my password is hunter2.`;

type Recorder = { writes: string[]; reads: string[] };

function recordingKv(log: Recorder, inner: KvArea = memoryKv()): KvArea {
  return {
    name: inner.name,
    get: (key) => {
      log.reads.push(`get:${key}`);
      return inner.get(key);
    },
    set: (key, value) => {
      log.writes.push(`set:${key}`);
      return inner.set(key, value);
    },
    remove: (key) => {
      log.writes.push(`remove:${key}`);
      return inner.remove(key);
    },
    clear: () => {
      log.writes.push("clear");
      return inner.clear();
    },
  };
}

/** Counts `open` calls, so a step that touches IndexedDB at all is visible. */
function spyFactory(real: IDBFactory, count: { opens: number }): IDBFactory {
  const spy: IDBFactory = {
    open: (name: string, version?: number) => {
      count.opens++;
      return version === undefined ? real.open(name) : real.open(name, version);
    },
    deleteDatabase: (name: string) => real.deleteDatabase(name),
    cmp: (a: unknown, b: unknown) => real.cmp(a, b),
    databases: () => real.databases(),
  };
  return spy;
}

async function routerHarness() {
  const log: Recorder = { writes: [], reads: [] };
  const opens = { opens: 0 };
  const factory = spyFactory(new IDBFactory(), opens);
  const local = recordingKv(log);
  const session = recordingKv(log);
  const clock = createFakeClock(T0);
  const opened = await openStorage({
    local,
    session,
    idbFactory: factory,
    now: () => clock.now(),
    idbKeyRange: keyRange,
  });
  const engine = createEngine({
    repos: opened.repos,
    ports: fakePorts(),
    clock,
    newId: () => "sess1",
  });
  const id = "p".repeat(32);
  const router = createRouter({
    runtimeId: id,
    getURL: (p) => `chrome-extension://${id}/${p}`,
    engine: () => Promise.resolve(engine),
    now: () => T0,
    tzOffsetMin: () => 60,
  });
  const sender = { id, url: `chrome-extension://${id}/sidepanel.html` };
  return { router, sender, log, opens, close: opened.close };
}

describe("the sentence never leaves memory", () => {
  it("returns only capped fields, and no field holds the whole sentence", () => {
    const { draft, warnings } = parseIntent(LONG_SENTENCE, ctx());
    expect(draft.taskLabel.length).toBeLessThanOrEqual(LIMITS.taskLabel);
    expect(draft.objective.length).toBeLessThanOrEqual(LIMITS.objective);
    const json = JSON.stringify({ draft, warnings });
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("555 0101");
    expect(json).not.toContain(LONG_SENTENCE);
    // The label and objective are the only places the user's words appear.
    const fromText = [draft.taskLabel, draft.objective];
    expect(fromText.some((v) => v.includes(SECRET))).toBe(true);
    for (const w of warnings) expect(JSON.stringify(w.data ?? {})).not.toContain(SECRET);
    for (const keyword of draft.keywords) expect(keyword.length).toBeLessThanOrEqual(LIMITS.keywordLength);
  });

  it("keeps the draft inside every stored-record cap, so nothing larger can be persisted", () => {
    const { draft } = parseIntent(LONG_SENTENCE.repeat(3), ctx());
    expect(draft.taskLabel.length).toBeLessThanOrEqual(LIMITS.taskLabel);
    expect(draft.objective.length).toBeLessThanOrEqual(LIMITS.objective);
    expect(draft.allowedHosts.length).toBeLessThanOrEqual(LIMITS.allowedHosts);
    expect(draft.keywords.length).toBeLessThanOrEqual(LIMITS.keywords);
  });
});

describe("parse.intent stores nothing", () => {
  it("writes no key and opens no database", async () => {
    const h = await routerHarness();
    // Baseline: startup (openStorage) has already run and may have written meta/prefs.
    h.log.writes.length = 0;
    h.log.reads.length = 0;
    h.opens.opens = 0;

    const reply = await h.router.handle(
      { v: 1, id: "req-1", type: "parse.intent", payload: { text: LONG_SENTENCE } },
      h.sender,
    );

    expect(reply).toMatchObject({ id: "req-1", ok: true });
    expect(h.log.writes).toEqual([]);
    expect(h.opens.opens).toBe(0);
    // Only the preferences read that supplies the default mode.
    expect(h.log.reads).toEqual(["get:prefs"]);
    const data = (reply as { data: { draft: { objective: string }; warnings: unknown[] } }).data;
    expect(data.draft.objective).toContain(SECRET);
    expect(JSON.stringify(data)).not.toContain("hunter2");
    h.close();
  });

  it("works when storage cannot be opened at all (safe mode, no prefs)", async () => {
    const id = "q".repeat(32);
    const router = createRouter({
      runtimeId: id,
      getURL: (p) => `chrome-extension://${id}/${p}`,
      engine: () => Promise.reject(new Error("no storage")),
      now: () => T0,
      tzOffsetMin: () => 60,
    });
    const reply = await router.handle(
      { v: 1, id: "req-2", type: "parse.intent", payload: { text: "revise chemistry for 1 hour" } },
      { id, url: `chrome-extension://${id}/sidepanel.html` },
    );
    expect(reply).toEqual({
      id: "req-2",
      ok: true,
      data: {
        draft: {
          taskLabel: "Chemistry",
          objective: "revise chemistry",
          allowedHosts: [],
          keywords: ["chemistry"],
          plannedMin: 60,
          mode: "gentle",
        },
        warnings: [],
      },
    });
  });
});
