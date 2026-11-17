// Engine (ARCHITECTURE §4): serialisation, persist-before-effects, persist failure,
// crash between persist and effects (AC-02), ENDING crash recovery, corrupt state,
// snapshot dedup, and the effect runner.
import { describe, expect, it, vi } from "vitest";
import type { ReduceResult } from "../../../src/core/session/types";
import { validateActiveState } from "../../../src/core/storage/validate";
import type { ActiveState } from "../../../src/core/types";
import { StorageError } from "../../../src/shell/storage/idb";
import { KEY_ACTIVE, KEY_DIAG } from "../../../src/shell/storage/kvRepos";
import { STORAGE_DELETED } from "../../../src/shell/storage/kvLock";
import { memoryKv } from "../../../src/shell/storage/memoryKv";
import { freshFactory, segment } from "../storage/fixtures";
import { command, engineFor, fakePorts, harness, MIN, startDraft, T0 } from "./fakes";

const diagCodes = async (h: { repos: { diag: { list(): Promise<{ code: string }[]> } } }) =>
  (await h.repos.diag.list()).map((e) => e.code);

describe("serialised queue", () => {
  it("processes inputs one at a time, in order, each seeing the previous result", async () => {
    const h = await harness();
    const ports = fakePorts();
    const engine = engineFor(h, ports);
    const order: string[] = [];
    const get = h.repos.active.get.bind(h.repos.active);
    h.repos.active.get = async () => {
      order.push("get");
      await new Promise((r) => setTimeout(r, 5));
      const v = await get();
      order.push("got");
      return v;
    };
    const [a, b, c] = await Promise.all([
      engine.enqueue({ kind: "startup" }),
      engine.enqueue(command("session.start", startDraft)),
      engine.enqueue(command("session.pause")),
    ]);
    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(order).toEqual(["get", "got", "get", "got", "get", "got"]);
    const read = await h.repos.active.get();
    expect("state" in read && read.state.session.state).toBe("PAUSED");
  });

  it("run() jobs queue behind earlier inputs", async () => {
    const h = await harness();
    const engine = engineFor(h, fakePorts());
    const started = engine.enqueue(command("session.start", startDraft));
    const seen = await engine.run(async (repos) => {
      const r = await repos.active.get();
      return "state" in r;
    });
    await started;
    expect(seen).toBe(true);
  });

  it("an engine failure doesn't stop the queue", async () => {
    const h = await harness();
    const engine = engineFor(h, fakePorts());
    h.repos.prefs.get = () => Promise.reject(new Error("x"));
    const original = h.repos.active.get.bind(h.repos.active);
    h.repos.active.get = vi.fn().mockRejectedValueOnce(new Error("boom")).mockImplementation(original);
    expect(await engine.enqueue({ kind: "tick" })).toEqual({ ok: false, error: "storage_error" });
    expect(await diagCodes(h)).toContain("E_ACTIVE_READ");
    // Prefs read failure falls back to defaults.
    expect((await engine.enqueue(command("session.start", startDraft))).ok).toBe(true);
  });
});

describe("persist before effects", () => {
  it("writes session.active before the first effect runs", async () => {
    const h = await harness();
    const log: string[] = [];
    const ports = fakePorts(log);
    const set = h.local.set.bind(h.local);
    h.local.set = async (k, v) => {
      if (k === KEY_ACTIVE) log.push("persist");
      return set(k, v);
    };
    await engineFor(h, ports).enqueue(command("session.start", startDraft));
    expect(log[0]).toBe("persist");
    expect(log).toContain("notify.create:fb.start.sess1");
    expect(log.indexOf("persist")).toBeLessThan(log.indexOf("alarm.create:fb.sessionEnd"));
  });

  it("a no-op input writes nothing", async () => {
    const h = await harness();
    const engine = engineFor(h, fakePorts());
    await engine.enqueue(command("session.start", startDraft));
    const set = vi.spyOn(h.local, "set");
    h.clock.advance(10_000);
    await engine.enqueue({ kind: "tick" });
    expect(set.mock.calls.filter(([k]) => k === KEY_ACTIVE)).toEqual([]);
  });

  it("persist failure → no effects, diag code, storage_error reply and notice", async () => {
    const h = await harness();
    const ports = fakePorts();
    const engine = engineFor(h, ports);
    const set = h.local.set.bind(h.local);
    h.local.set = (k, v) => (k === KEY_ACTIVE ? Promise.reject(new Error("quota")) : set(k, v));
    const r = await engine.enqueue(command("session.start", startDraft));
    expect(r).toEqual({ ok: false, error: "storage_error" });
    expect(ports.log).toEqual([]);
    expect(await diagCodes(h)).toContain("E_PERSIST_FAILED");
    h.local.set = set;
    await engine.enqueue(command("session.start", startDraft));
    expect(ports.snapshot.published.at(-1)?.notices.map((n) => n.code)).toEqual(["storage_error"]);
  });

  it("E_STORAGE_DELETED → the input is dropped quietly (no effects, no diag)", async () => {
    const h = await harness();
    const ports = fakePorts();
    h.repos.active.put = () => Promise.reject(new StorageError(STORAGE_DELETED));
    const r = await engineFor(h, ports).enqueue(command("session.start", startDraft));
    expect(r).toEqual({ ok: false, error: "storage_error" });
    expect(ports.log).toEqual([]);
    expect(await diagCodes(h)).toEqual([]);
  });

  it("a write the validator refuses → internal, no effects", async () => {
    const h = await harness();
    const ports = fakePorts();
    const bad: ReduceResult = {
      state: { schemaVersion: 2 } as unknown as ActiveState,
      effects: [{ type: "PublishSnapshot" }],
    };
    const r = await engineFor(h, ports, { reduce: () => bad }).enqueue({ kind: "tick" });
    expect(r).toEqual({ ok: false, error: "internal" });
    expect(ports.log).toEqual([]);
    expect(await diagCodes(h)).toContain("E_ACTIVE_INVALID_WRITE");
  });

  it("a throwing reducer → internal + diag", async () => {
    const h = await harness();
    const r = await engineFor(h, fakePorts(), {
      reduce: () => {
        throw new Error("bug");
      },
    }).enqueue({ kind: "tick" });
    expect(r).toEqual({ ok: false, error: "internal" });
    expect(await diagCodes(h)).toContain("E_REDUCER_THREW");
  });

  it("reducer errors are replied with their data and change nothing", async () => {
    const h = await harness();
    const engine = engineFor(h, fakePorts());
    await engine.enqueue(command("session.start", startDraft));
    expect(await engine.enqueue(command("session.start", startDraft))).toEqual({
      ok: false,
      error: "invalid_state",
      data: { activeSessionId: "sess1" },
    });
  });
});

describe("crash between persist and effects, then restart (AC-02)", () => {
  it("the start notification is never shown twice", async () => {
    const local = memoryKv();
    const factory = freshFactory();
    const h1 = await harness(local, factory);
    const ports1 = fakePorts();
    ports1.broken = true; // persisted, then "crashed" before any effect completed
    await engineFor(h1, ports1).enqueue(command("session.start", startDraft));
    h1.close();
    const stored = await local.get(KEY_ACTIVE);
    expect(validateActiveState(stored).ok).toBe(true);

    const h2 = await harness(local, factory, T0 + 5_000);
    const ports2 = fakePorts();
    const engine2 = engineFor(h2, ports2);
    await engine2.enqueue({ kind: "startup" });
    await engine2.enqueue({ kind: "startup" });
    expect(ports2.notifications.created).toEqual([]);
    expect(ports2.action.badge).toBe("ON");
    expect([...ports2.alarms.live.keys()].sort()).toEqual(["fb.sessionEnd", "fb.tick"]);
    expect(ports2.alarms.live.get("fb.sessionEnd")).toEqual({ when: T0 + 60 * MIN });
    expect(ports2.snapshot.published.at(-1)?.session?.endsAt).toBe(T0 + 60 * MIN);
  });

  it("effect failures become diag codes; the remaining effects still run", async () => {
    const h = await harness();
    const ports = fakePorts();
    ports.notifications.create = () => Promise.reject(new Error("denied"));
    await engineFor(h, ports).enqueue(command("session.start", startDraft));
    expect(ports.action.badge).toBe("ON");
    expect(ports.snapshot.published).toHaveLength(1);
    expect(await diagCodes(h)).toContain("E_FX_NOTIFICATION_CREATE");
  });
});

describe("ENDING", () => {
  it("stop: SessionRecord written, segments purged, interventions kept, session.active removed, lastSummaryId published", async () => {
    const h = await harness();
    const ports = fakePorts();
    const engine = engineFor(h, ports);
    await engine.enqueue(command("session.start", startDraft));
    await h.repos.segments?.append(segment({ sessionId: "sess1", seq: 0 }));
    await h.repos.interventions?.put({
      sessionId: "sess1",
      id: "i1",
      episodeId: "e1",
      level: 1,
      createdAt: T0,
      deliveredVia: ["badge"],
    });
    h.clock.advance(30 * MIN);
    expect(await engine.enqueue(command("session.stop"))).toEqual({ ok: true });
    const rec = await h.repos.sessions?.get("sess1");
    expect(rec).toMatchObject({ id: "sess1", endReason: "user_stop", endedAt: T0 + 30 * MIN, actualMin: 30 });
    expect(await h.repos.segments?.count("sess1")).toBe(0);
    // D-022: interventions are aggregate data and stay with their SessionRecord.
    expect((await h.repos.interventions?.listForSession("sess1"))?.map((i) => i.id)).toEqual(["i1"]);
    expect(await h.repos.active.get()).toEqual({ none: true });
    expect(ports.alarms.live.size).toBe(0);
    expect(ports.notifications.live.size).toBe(0);
    expect(ports.action.badge).toBe("");
    expect(ports.snapshot.published.at(-1)).toMatchObject({ session: null, lastSummaryId: "sess1" });
  });

  it("crash during summary → next Startup finishes it; an existing record is not rebuilt", async () => {
    const local = memoryKv();
    const factory = freshFactory();
    const h1 = await harness(local, factory);
    const e1 = engineFor(h1, fakePorts());
    await e1.enqueue(command("session.start", startDraft));
    h1.clock.advance(10 * MIN);
    const put = h1.repos.sessions!.put.bind(h1.repos.sessions);
    h1.repos.sessions!.put = () => Promise.reject(new Error("crash"));
    await e1.enqueue(command("session.stop"));
    const mid = await h1.repos.active.get();
    expect("state" in mid && mid.state.session.state).toBe("ENDING");
    expect(await diagCodes(h1)).toContain("E_SUMMARY_WRITE");
    h1.repos.sessions!.put = put;
    h1.close();

    const h2 = await harness(local, factory, T0 + 60 * MIN);
    const ports2 = fakePorts();
    await engineFor(h2, ports2).enqueue({ kind: "startup" });
    expect(await h2.repos.sessions?.get("sess1")).toMatchObject({ endReason: "user_stop", endedAt: T0 + 10 * MIN });
    expect(await h2.repos.active.get()).toEqual({ none: true });
    expect(ports2.notifications.created).toEqual([]);
    expect(ports2.snapshot.published.at(-1)?.lastSummaryId).toBe("sess1");

    // Crash after the record but before removing session.active: no rebuild.
    const h3 = await harness(local, factory);
    const e3 = engineFor(h3, fakePorts());
    await e3.enqueue(command("session.start", startDraft)); // sess1 again (fresh id counter)
    await h3.repos.active.put({
      ...((await h3.repos.active.get()) as { state: ActiveState }).state,
      session: {
        ...((await h3.repos.active.get()) as { state: ActiveState }).state.session,
        state: "ENDING",
        ending: { endReason: "time_up", endedAt: T0 + 5 * MIN },
      },
    });
    const spy = vi.spyOn(h3.repos.sessions!, "put");
    await e3.enqueue({ kind: "startup" });
    expect(spy).not.toHaveBeenCalled();
    expect((await h3.repos.sessions?.get("sess1"))?.endReason).toBe("user_stop");
    expect(await h3.repos.active.get()).toEqual({ none: true });
  });

  it("safe mode (no IndexedDB): the session closes without a summary", async () => {
    const h = await harness();
    const repos = { ...h.repos, sessions: null, segments: null, interventions: null };
    const ports = fakePorts();
    const engine = engineFor({ ...h, repos }, ports);
    await engine.enqueue(command("session.start", startDraft));
    await engine.enqueue(command("session.stop"));
    expect(await h.repos.active.get()).toEqual({ none: true });
    expect(await diagCodes(h)).toContain("E_SUMMARY_SAFE_MODE");
    expect(ports.snapshot.published.at(-1)?.lastSummaryId).toBeUndefined();
  });

  it("a SessionRecord the validator refuses is reported, and the session still closes", async () => {
    const h = await harness();
    h.repos.sessions!.put = () => Promise.resolve({ ok: false, errors: ["x"] });
    const engine = engineFor(h, fakePorts());
    await engine.enqueue(command("session.start", startDraft));
    await engine.enqueue(command("session.stop"));
    expect(await diagCodes(h)).toContain("E_SUMMARY_INVALID");
    expect(await h.repos.active.get()).toEqual({ none: true });
  });

  it("summary with no matching state is reported (E_SUMMARY_NO_STATE)", async () => {
    const h = await harness();
    const r: ReduceResult = {
      state: null,
      effects: [{ type: "BuildSummaryAndPurgeRaw", sessionId: "ghost", endReason: "user_stop", endedAt: T0 }],
    };
    await engineFor(h, fakePorts(), { reduce: () => r }).enqueue({ kind: "tick" });
    expect(await diagCodes(h)).toContain("E_SUMMARY_NO_STATE");
  });

  it("E_STORAGE_DELETED during the summary is quiet", async () => {
    const h = await harness();
    const engine = engineFor(h, fakePorts());
    await engine.enqueue(command("session.start", startDraft));
    h.repos.sessions!.get = () => Promise.reject(new StorageError(STORAGE_DELETED));
    await engine.enqueue(command("session.stop"));
    expect((await diagCodes(h)).filter((c) => c.startsWith("E_SUMMARY"))).toEqual([]);
  });
});

describe("corrupt session.active", () => {
  it("Startup removes it (no summary) and records a diag code", async () => {
    const local = memoryKv({ [KEY_ACTIVE]: { schemaVersion: 1, title: "leak" } });
    const h = await harness(local);
    const ports = fakePorts();
    const r = await engineFor(h, ports).enqueue({ kind: "startup" });
    expect(r.ok).toBe(true);
    expect(await local.get(KEY_ACTIVE)).toBeUndefined();
    expect(await diagCodes(h)).toContain("E_ACTIVE_CORRUPT_ENDED");
    expect(await h.repos.sessions?.list()).toEqual([]);
    expect(ports.action.badge).toBe("");
  });

  it("any other input first ends the corrupt session, then applies", async () => {
    const local = memoryKv({ [KEY_ACTIVE]: "garbage" });
    const h = await harness(local);
    const r = await engineFor(h, fakePorts()).enqueue(command("session.start", startDraft));
    expect(r).toEqual({ ok: true, data: { sessionId: "sess1" } });
    const read = await h.repos.active.get();
    expect("state" in read).toBe(true);
  });

  it("if removing the corrupt state fails, the input is not applied", async () => {
    const local = memoryKv({ [KEY_ACTIVE]: "garbage" });
    const h = await harness(local);
    h.repos.active.remove = () => Promise.reject(new Error("io"));
    const r = await engineFor(h, fakePorts()).enqueue(command("session.start", startDraft));
    expect(r).toEqual({ ok: false, error: "storage_error" });
  });
});

describe("snapshot", () => {
  it("published only when its content changes", async () => {
    const h = await harness();
    const ports = fakePorts();
    const engine = engineFor(h, ports);
    await engine.enqueue({ kind: "startup" });
    await engine.enqueue({ kind: "startup" });
    expect(ports.snapshot.published).toHaveLength(1);
    await engine.enqueue(command("session.start", startDraft));
    expect(ports.snapshot.published).toHaveLength(2);
    h.clock.advance(MIN);
    await engine.enqueue({ kind: "startup" });
    expect(ports.snapshot.published).toHaveLength(2);
  });

  it("lastSummaryId is seeded from the stored snapshot on Startup; invalid ids are ignored", async () => {
    const h = await harness();
    const ports = fakePorts();
    ports.snapshot.stored = { v: 1, at: 1, session: null, notices: [], lastSummaryId: "prev_1" };
    await engineFor(h, ports).enqueue({ kind: "startup" });
    expect(ports.snapshot.published.at(-1)?.lastSummaryId).toBe("prev_1");
    const p2 = fakePorts();
    p2.snapshot.stored = { lastSummaryId: "bad id" };
    await engineFor(h, p2).enqueue({ kind: "startup" });
    expect(p2.snapshot.published.at(-1)?.lastSummaryId).toBeUndefined();
    const p3 = fakePorts();
    p3.snapshot.read = () => Promise.reject(new Error("x"));
    expect((await engineFor(h, p3).enqueue({ kind: "startup" })).ok).toBe(true);
  });

  it("start-up notices are carried in every snapshot", async () => {
    const h = await harness();
    const ports = fakePorts();
    await engineFor(h, ports, { notices: [{ code: "safe_mode", at: 3 }] }).enqueue({ kind: "startup" });
    expect(ports.snapshot.published[0]?.notices).toEqual([{ code: "safe_mode", at: 3 }]);
  });
});

describe("effect runner", () => {
  it("formats notification and tooltip text from the message bank", async () => {
    const h = await harness();
    const ports = fakePorts();
    await engineFor(h, ports).enqueue(command("session.start", startDraft));
    expect(ports.notifications.live.get("fb.start.sess1")).toEqual({
      title: "Focus session started",
      message: "Write report for 1 h. Tab titles are checked on this computer until you stop.",
    });
    expect(ports.action.title).toBe("Focus session on: Write report, 1 h left");
    expect(ports.action.color).toBe("#0b6e69");
    expect(ports.alarms.live.get("fb.tick")).toEqual({ periodMin: 0.5 });
  });

  it("AppendSegment: duplicate seq counts as already written; invalid rows are reported; safe mode skips", async () => {
    const h = await harness();
    const seg = segment({ sessionId: "s9", seq: 3 });
    const r: ReduceResult = { state: null, effects: [{ type: "AppendSegment", segment: seg }] };
    const engine = engineFor(h, fakePorts(), { reduce: () => r });
    await engine.enqueue({ kind: "tick" });
    await engine.enqueue({ kind: "tick" });
    expect(await h.repos.segments?.count("s9")).toBe(1);
    expect(await diagCodes(h)).toEqual([]);
    const bad: ReduceResult = { state: null, effects: [{ type: "AppendSegment", segment: { ...seg, seq: -1 } }] };
    await engineFor(h, fakePorts(), { reduce: () => bad }).enqueue({ kind: "tick" });
    expect(await diagCodes(h)).toContain("E_SEGMENT_INVALID");
    const safe = { ...h, repos: { ...h.repos, segments: null } };
    expect((await engineFor(safe, fakePorts(), { reduce: () => r }).enqueue({ kind: "tick" })).ok).toBe(true);
  });

  it("diag append failures never break the input", async () => {
    const h = await harness();
    h.repos.diag.appendMany = () => Promise.reject(new Error("x"));
    const ports = fakePorts();
    ports.action.setTitle = () => Promise.reject(new Error("y"));
    expect((await engineFor(h, ports).enqueue(command("session.start", startDraft))).ok).toBe(true);
  });

  it("ScheduleAlarm without when or period defaults to the tick period", async () => {
    const h = await harness();
    const ports = fakePorts();
    const r: ReduceResult = { state: null, effects: [{ type: "ScheduleAlarm", name: "fb.tick" }] };
    await engineFor(h, ports, { reduce: () => r }).enqueue({ kind: "tick" });
    expect(ports.alarms.live.get("fb.tick")).toEqual({ periodMin: 0.5 });
  });
});

describe("diag", () => {
  it("never stores free text", async () => {
    const h = await harness();
    const r: ReduceResult = { state: null, effects: [{ type: "Diag", code: "https://evil/x" }] };
    await engineFor(h, fakePorts(), { reduce: () => r }).enqueue({ kind: "tick" });
    const raw = JSON.stringify(await h.local.get(KEY_DIAG));
    expect(raw).not.toContain("evil");
  });
});
