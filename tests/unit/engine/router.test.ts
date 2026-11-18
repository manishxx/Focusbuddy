// Messaging router (API_CONTRACTS §1 envelope, §2 sender validation, §3 dispatch).
import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, resolveVars } from "../../../src/shell/engine/format";
import { kvSnapshotPort } from "../../../src/shell/engine/snapshotPort";
import { createRouter, isExtensionPageSender, type SenderInfo } from "../../../src/shell/messaging/router";
import { KEY_UI_SNAPSHOT } from "../../../src/shell/storage/deleteAll";
import { withAreaExclusive } from "../../../src/shell/storage/kvLock";
import { memoryKv } from "../../../src/shell/storage/memoryKv";
import { engineFor, fakePorts, harness, startDraft } from "./fakes";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const getURL = (p: string) => `chrome-extension://${ID}/${p}`;
const page = (p = "sidepanel.html", over: Partial<SenderInfo> = {}): SenderInfo => ({
  id: ID,
  url: getURL(p),
  ...over,
});
const msg = (type: string, payload: unknown = {}, over: Record<string, unknown> = {}) => ({
  v: 1,
  id: "req-1",
  type,
  payload,
  ...over,
});

async function setup() {
  const h = await harness();
  const engine = engineFor(h, fakePorts());
  await engine.enqueue({ kind: "startup" });
  const router = createRouter({ runtimeId: ID, getURL, engine: () => Promise.resolve(engine) });
  return { h, engine, router };
}

describe("sender validation (§2, exact)", () => {
  it.each(["sidepanel.html", "options.html", "intervention.html"])("accepts %s, also opened in a tab", (p) => {
    expect(isExtensionPageSender(page(p), ID, getURL)).toBe(true);
    expect(isExtensionPageSender(page(p, { tab: { id: 3 }, frameId: 0 }), ID, getURL)).toBe(true);
    expect(isExtensionPageSender(page(p, { url: `${getURL(p)}?x=1` }), ID, getURL)).toBe(true);
    expect(isExtensionPageSender(page(p, { url: `${getURL(p)}#confirm` }), ID, getURL)).toBe(true);
  });
  it.each<[string, SenderInfo]>([
    ["web page with the same file name", { id: ID, url: "https://evil/sidepanel.html", tab: { id: 1 } }],
    ["content script (page URL, tab)", { id: ID, url: "https://example.com/page", tab: { id: 1 }, frameId: 0 }],
    ["other extension id", { id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", url: getURL("sidepanel.html") }],
    ["other extension's page URL", { id: ID, url: "chrome-extension://zzzz/sidepanel.html" }],
    ["offscreen document", { id: ID, url: getURL("offscreen.html") }],
    ["service worker url", { id: ID, url: getURL("sw.js") }],
    ["suffix match", { id: ID, url: `${getURL("x")}/sidepanel.html` }],
    ["prefix match", { id: ID, url: `${getURL("sidepanel.html")}x` }],
    ["path traversal", { id: ID, url: getURL("sub/../sidepanel.html") }],
    ["no url", { id: ID }],
    ["no id", { url: getURL("sidepanel.html") }],
    ["query before path", { id: ID, url: `chrome-extension://${ID}/?/sidepanel.html` }],
  ])("rejects %s", async (_n, sender) => {
    expect(isExtensionPageSender(sender, ID, getURL)).toBe(false);
    const { router } = await setup();
    expect(await router.handle(msg("prefs.get"), sender)).toEqual({
      id: "req-1",
      ok: false,
      error: "forbidden_sender",
    });
  });
  it("forbidden sender with a garbage message → forbidden_sender with empty id", async () => {
    const { router } = await setup();
    expect(await router.handle("x", { id: "x" })).toEqual({ id: "", ok: false, error: "forbidden_sender" });
  });
  it("overlay.response from an extension page → forbidden_sender", async () => {
    const { router } = await setup();
    expect(await router.handle(msg("overlay.response", {}, { nonce: "n" }), page())).toEqual({
      id: "req-1",
      ok: false,
      error: "forbidden_sender",
    });
  });
});

describe("envelope (§1)", () => {
  it.each<[string, unknown]>([
    ["not an object", "hello"],
    ["array", [1]],
    ["v 2", msg("prefs.get", {}, { v: 2 })],
    ["v missing", { id: "a", type: "prefs.get", payload: {} }],
    ["id missing", { v: 1, type: "prefs.get", payload: {} }],
    ["id with spaces", msg("prefs.get", {}, { id: "a b" })],
    ["id too long", msg("prefs.get", {}, { id: "a".repeat(65) })],
    ["payload missing", { v: 1, id: "a", type: "prefs.get" }],
    ["unknown field", msg("prefs.get", {}, { url: "https://x" })],
    ["type not a string", msg("prefs.get", {}, { type: 5 })],
    ["type malformed", msg("prefs.get", {}, { type: "PREFS" })],
    ["nonce not a string", msg("prefs.get", {}, { nonce: 5 })],
    ["nonce too long", msg("prefs.get", {}, { nonce: "n".repeat(129) })],
    [
      "getter",
      Object.defineProperty({ v: 1, id: "a", payload: {} }, "type", { get: () => "prefs.get", enumerable: true }),
    ],
  ])("%s → invalid_message", async (_n, m) => {
    const { router } = await setup();
    const r = await router.handle(m, page());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBe("invalid_message");
  });
  it("echoes a valid id in error replies", async () => {
    const { router } = await setup();
    expect(await router.handle(msg("prefs.get", {}, { extra: 1, id: "keep-me" }), page())).toEqual({
      id: "keep-me",
      ok: false,
      error: "invalid_message",
    });
  });
});

describe("dispatch (§3)", () => {
  it("session.* and break.* go to the engine; replies carry data", async () => {
    const { router } = await setup();
    const start = await router.handle(msg("session.start", startDraft), page());
    expect(start).toEqual({ id: "req-1", ok: true, data: { sessionId: "sess1" } });
    expect(await router.handle(msg("session.start", startDraft), page())).toEqual({
      id: "req-1",
      ok: false,
      error: "invalid_state",
      data: { activeSessionId: "sess1" },
    });
    expect(await router.handle(msg("break.start", { minutes: 5 }), page("options.html"))).toEqual({
      id: "req-1",
      ok: true,
    });
    expect(await router.handle(msg("break.extend", { minutes: 99 }), page())).toEqual({
      id: "req-1",
      ok: false,
      error: "invalid_argument",
    });
    expect(await router.handle(msg("break.extend", { minutes: "9" }), page())).toEqual({
      id: "req-1",
      ok: false,
      error: "invalid_message",
    });
    expect(await router.handle(msg("session.stop"), page("intervention.html"))).toEqual({ id: "req-1", ok: true });
  });
  it("prefs.get and diag.get", async () => {
    const { router, h } = await setup();
    const p = await router.handle(msg("prefs.get"), page());
    expect(p.ok && (p.data as { prefs: { schemaVersion: number } }).prefs.schemaVersion).toBe(1);
    await h.repos.diag.append("E_TEST_CODE");
    expect(await router.handle(msg("diag.get"), page())).toMatchObject({
      ok: true,
      data: { entries: [{ code: "E_TEST_CODE" }] },
    });
    expect((await router.handle(msg("prefs.get", { x: 1 }), page())).ok).toBe(false);
  });
  it("other contract types → not_implemented; unknown types → unknown_type", async () => {
    const { router } = await setup();
    for (const t of ["mute.set", "prefs.update", "data.deleteAll"]) {
      expect(await router.handle(msg(t), page())).toEqual({ id: "req-1", ok: false, error: "not_implemented" });
    }
    expect(await router.handle(msg("session.hack"), page())).toEqual({ id: "req-1", ok: false, error: "unknown_type" });
  });
  it("parse.intent replies with a draft and warnings, and stores nothing (API_CONTRACTS §3)", async () => {
    const { h, router } = await setup();
    const before = h.local.keys().sort();
    const reply = await router.handle(msg("parse.intent", { text: "Revise chemistry for 90 min on Quizlet" }), page());
    expect(reply).toEqual({
      id: "req-1",
      ok: true,
      data: {
        draft: {
          taskLabel: "Chemistry",
          objective: "Revise chemistry on Quizlet",
          allowedHosts: ["quizlet.com"],
          keywords: ["chemistry", "quizlet"],
          plannedMin: 90,
          mode: "gentle",
        },
        warnings: [],
      },
    });
    expect(h.local.keys().sort()).toEqual(before);
  });
  it("parse.intent uses the mode from preferences and the injected time zone", async () => {
    const h = await harness();
    const engine = engineFor(h, fakePorts());
    await engine.enqueue({ kind: "startup" });
    await h.repos.prefs.update({ defaultMode: "strict" });
    const router = createRouter({
      runtimeId: ID,
      getURL,
      engine: () => Promise.resolve(engine),
      now: () => Date.UTC(2026, 10, 18, 9, 0, 0),
      tzOffsetMin: () => 60,
    });
    const reply = await router.handle(msg("parse.intent", { text: "Write my essay until 5pm" }), page());
    expect(reply).toMatchObject({ ok: true, data: { draft: { mode: "strict", plannedMin: 420 } } });
  });
  it.each<[string, unknown]>([
    ["not an object", "x"],
    ["missing text", {}],
    ["wrong type", { text: 5 }],
    ["unknown key", { text: "ok", extra: 1 }],
  ])("parse.intent with %s → invalid_message", async (_n, payload) => {
    const { router } = await setup();
    expect(await router.handle(msg("parse.intent", payload), page())).toEqual({
      id: "req-1",
      ok: false,
      error: "invalid_message",
    });
  });
  it("parse.intent over 1000 characters → invalid_argument", async () => {
    const { router } = await setup();
    expect(await router.handle(msg("parse.intent", { text: "x".repeat(1001) }), page())).toEqual({
      id: "req-1",
      ok: false,
      error: "invalid_argument",
    });
  });
  it("storage that can't open → storage_error, never internal (D-023)", async () => {
    const router = createRouter({ runtimeId: ID, getURL, engine: () => Promise.reject(new Error("no storage")) });
    expect(await router.handle(msg("prefs.get"), page())).toEqual({ id: "req-1", ok: false, error: "storage_error" });
    expect(await router.handle(msg("session.start", startDraft), page())).toEqual({
      id: "req-1",
      ok: false,
      error: "storage_error",
    });
  });
  it("an engine job that throws → internal", async () => {
    const { engine } = await setup();
    const broken = { ...engine, run: () => Promise.reject(new Error("bug")) };
    const router = createRouter({ runtimeId: ID, getURL, engine: () => Promise.resolve(broken) });
    expect(await router.handle(msg("prefs.get"), page())).toEqual({ id: "req-1", ok: false, error: "internal" });
  });
});

describe("format", () => {
  it("durations round up to minutes", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(1)).toBe("1 min");
    expect(formatDuration(45 * 60_000)).toBe("45 min");
    expect(formatDuration(60 * 60_000)).toBe("1 h");
    expect(formatDuration(125 * 60_000)).toBe("2 h 5 min");
    expect(formatDuration(-5)).toBe("0 min");
  });
  it("clock times and plain values", () => {
    expect(formatClock(0)).toMatch(/\d{1,2}.\d{2}/);
    expect(resolveVars({ a: "x", b: 2, c: { kind: "duration", ms: 60_000 } })).toEqual({ a: "x", b: 2, c: "1 min" });
  });
});

describe("kvSnapshotPort", () => {
  it("reads and publishes ui.snapshot; a publish queued before Delete all is refused", async () => {
    const session = memoryKv();
    const port = kvSnapshotPort(session);
    await port.publish({ v: 1, at: 1, session: null, notices: [] });
    expect(await port.read()).toEqual({ v: 1, at: 1, session: null, notices: [] });
    let late: Promise<void> | undefined;
    await withAreaExclusive(session, async () => {
      late = port.publish({ v: 1, at: 2, session: null, notices: [] });
      await session.clear();
    });
    await expect(late).rejects.toThrow("E_STORAGE_DELETED");
    expect(await session.get(KEY_UI_SNAPSHOT)).toBeUndefined();
  });
});
