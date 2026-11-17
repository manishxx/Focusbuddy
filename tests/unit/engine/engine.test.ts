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
  it("the start notification is never shown twice (and a lost one is shown once, AC-32)", async () => {
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
    // AC-32 (review F5): lost within 60 s of the start, so it's shown exactly once more.
    expect(ports2.notifications.created).toEqual(["fb.start.sess1"]);
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

describe("D-023 review F3: ENDING is retried on every input", () => {
  async function stuckEnding() {
    const h = await harness();
    const ports = fakePorts();
    const engine = engineFor(h, ports);
    await engine.enqueue(command("session.start", startDraft));
    h.clock.advance(10 * MIN);
    const put = h.repos.sessions!.put.bind(h.repos.sessions);
    let failing = true;
    h.repos.sessions!.put = (r) => (failing ? Promise.reject(new Error("quota")) : put(r));
    await engine.enqueue(command("session.stop"));
    const read = await h.repos.active.get();
    expect("state" in read && read.state.session.state).toBe("ENDING");
    return { h, ports, engine, recover: () => (failing = false) };
  }

  it("while the repo keeps failing: stop → ok, start → invalid_state, nothing else changes", async () => {
    const { h, engine } = await stuckEnding();
    expect(await engine.enqueue(command("session.stop"))).toEqual({ ok: true });
    expect(await engine.enqueue(command("session.start", startDraft))).toMatchObject({
      ok: false,
      error: "invalid_state",
    });
    const read = await h.repos.active.get();
    expect("state" in read && read.state.session.state).toBe("ENDING");
    expect(await h.repos.sessions?.get("sess1")).toBeNull();
  });

  it("after the repo recovers, the next input finishes the ending and then applies: start works", async () => {
    const { h, ports, engine, recover } = await stuckEnding();
    recover();
    h.clock.advance(MIN);
    const r = await engine.enqueue(command("session.start", startDraft));
    expect(r).toEqual({ ok: true, data: { sessionId: "sess2" } });
    expect(await h.repos.sessions?.get("sess1")).toMatchObject({ endReason: "user_stop", endedAt: T0 + 10 * MIN });
    const read = await h.repos.active.get();
    expect("state" in read && read.state.session.id).toBe("sess2");
    expect(ports.notifications.created).toEqual(["fb.start.sess1", "fb.start.sess2"]);
  });

  it("after recovery, stop on the stuck ENDING finishes it and replies ok", async () => {
    const { h, engine, recover } = await stuckEnding();
    recover();
    expect(await engine.enqueue(command("session.stop"))).toEqual({ ok: true });
    expect(await h.repos.active.get()).toEqual({ none: true });
    expect(await h.repos.sessions?.get("sess1")).not.toBeNull();
  });

  it("a tick also finishes it", async () => {
    const { h, engine, recover } = await stuckEnding();
    recover();
    expect((await engine.enqueue({ kind: "tick" })).ok).toBe(true);
    expect(await h.repos.active.get()).toEqual({ none: true });
  });

  it("a read failure after the retry → storage_error", async () => {
    const { h, engine } = await stuckEnding();
    const get = h.repos.active.get.bind(h.repos.active);
    let calls = 0;
    h.repos.active.get = () => (++calls === 2 ? Promise.reject(new Error("io")) : get());
    expect(await engine.enqueue(command("session.stop"))).toEqual({ ok: false, error: "storage_error" });
  });
});

describe("D-023 review F5 (AC-32): start notification after a crash", () => {
  async function crashedStart(restartAfterMs: number, existsImpl?: (id: string) => Promise<boolean>) {
    const local = memoryKv();
    const factory = freshFactory();
    const h1 = await harness(local, factory);
    const p1 = fakePorts();
    p1.broken = true;
    await engineFor(h1, p1).enqueue(command("session.start", startDraft));
    h1.close();
    const h2 = await harness(local, factory, T0 + restartAfterMs);
    const p2 = fakePorts();
    if (existsImpl) p2.notifications.exists = existsImpl;
    const e2 = engineFor(h2, p2);
    await e2.enqueue({ kind: "startup" });
    return { h2, p2, e2 };
  }

  it("within 60 s and not showing → shown once more; a later Startup doesn't repeat it", async () => {
    const { p2, e2, h2 } = await crashedStart(60_000);
    expect(p2.notifications.created).toEqual(["fb.start.sess1"]);
    p2.notifications.live.clear(); // dismissed by the user
    h2.clock.advance(1_000);
    await e2.enqueue({ kind: "startup" });
    expect(p2.notifications.created).toEqual(["fb.start.sess1"]);
  });

  it("after 60 s → not shown", async () => {
    const { p2 } = await crashedStart(60_001);
    expect(p2.notifications.created).toEqual([]);
  });

  it("already showing → not shown again; port failure counts as showing", async () => {
    expect((await crashedStart(5_000, () => Promise.resolve(true))).p2.notifications.created).toEqual([]);
    expect((await crashedStart(5_000, () => Promise.reject(new Error("x")))).p2.notifications.created).toEqual([]);
  });
});

describe("D-023 review F6: leftover notifications at Startup with no session", () => {
  it("clears every fb.* notification and leaves others", async () => {
    const h = await harness();
    const ports = fakePorts();
    for (const id of ["fb.start.old", "fb.continue.old", "fb.break.old", "other.thing"])
      ports.notifications.live.set(id, { title: "t", message: "m" });
    await engineFor(h, ports).enqueue({ kind: "startup" });
    expect([...ports.notifications.live.keys()]).toEqual(["other.thing"]);
  });
  it("a listIds failure is harmless", async () => {
    const h = await harness();
    const ports = fakePorts();
    ports.notifications.listIds = () => Promise.reject(new Error("x"));
    expect((await engineFor(h, ports).enqueue({ kind: "startup" })).ok).toBe(true);
  });
});

describe("D-023 review F7: idle events are back-dated by idleThresholdSec", () => {
  it("idle → at = now − threshold; locked and active use the event time; clamped to startedAt", async () => {
    const h = await harness();
    await h.repos.prefs.update({ idleThresholdSec: 120 });
    const engine = engineFor(h, fakePorts());
    await engine.enqueue(command("session.start", startDraft));
    h.clock.advance(10 * MIN);
    await engine.enqueue({ kind: "idle", state: "idle", at: h.clock.now() });
    let read = await h.repos.active.get();
    expect("state" in read && [read.state.attention, read.state.attentionSince]).toEqual(["IDLE", T0 + 8 * MIN]);
    // The 30-min rule counts from the last input: 28 min after the event = 30 min idle.
    h.clock.advance(28 * MIN);
    await engine.enqueue({ kind: "tick" });
    read = await h.repos.active.get();
    expect("state" in read && read.state.session).toMatchObject({ state: "PAUSED", awaySince: T0 + 8 * MIN });

    const h2 = await harness();
    await h2.repos.prefs.update({ idleThresholdSec: 1800 });
    const e2 = engineFor(h2, fakePorts());
    await e2.enqueue(command("session.start", startDraft));
    h2.clock.advance(MIN);
    await e2.enqueue({ kind: "idle", state: "idle", at: h2.clock.now() });
    let r2 = await h2.repos.active.get();
    expect("state" in r2 && r2.state.attentionSince).toBe(T0); // clamped to startedAt
    h2.clock.advance(MIN);
    await e2.enqueue({ kind: "idle", state: "locked", at: h2.clock.now() });
    r2 = await h2.repos.active.get();
    expect("state" in r2 && [r2.state.attention, r2.state.attentionSince]).toEqual(["LOCKED", T0 + 2 * MIN]);
  });
});

describe("safe mode (DATA_MODEL §5): monitoring disabled", () => {
  const SAFE = [{ code: "safe_mode" as const, at: T0 }];
  const COMMANDS: Array<[string, unknown]> = [
    ["session.start", startDraft],
    ["session.pause", {}],
    ["session.resume", {}],
    ["session.continue", {}],
    ["session.extend", { minutes: 5 }],
    ["session.stop", {}],
    ["session.updateNote", { objective: "x" }],
    ["break.start", { minutes: 5 }],
    ["break.end", {}],
    ["break.extend", { minutes: 5 }],
  ];

  it("every session.* / break.* command → storage_error with no state change; the snapshot keeps safe_mode", async () => {
    const h = await harness();
    const ports = fakePorts();
    const engine = engineFor(h, ports, { safeMode: true, notices: SAFE });
    await engine.enqueue({ kind: "startup" });
    const published = ports.snapshot.published.length;
    const set = vi.spyOn(h.local, "set");
    for (const [type, payload] of COMMANDS) {
      expect(await engine.enqueue(command(type, payload)), type).toEqual({ ok: false, error: "storage_error" });
    }
    expect(set.mock.calls.filter(([k]) => k === KEY_ACTIVE)).toEqual([]);
    expect(await h.repos.active.get()).toEqual({ none: true });
    expect(ports.notifications.created).toEqual([]);
    expect(ports.snapshot.published).toHaveLength(published);
    expect(ports.snapshot.published.at(-1)).toMatchObject({ session: null, notices: SAFE });
  });

  it.each([
    ["ACTIVE", [] as string[]],
    ["PAUSED", ["session.pause"]],
    ["ON_BREAK", ["break.start"]],
  ])(
    "a %s session found at boot is ended (stale_pause, no summary), with alarms, badge and notifications cleared",
    async (_name, setup) => {
      const local = memoryKv();
      const factory = freshFactory();
      const h1 = await harness(local, factory);
      const p1 = fakePorts();
      const e1 = engineFor(h1, p1);
      await e1.enqueue(command("session.start", startDraft));
      for (const t of setup) await e1.enqueue(command(t, t === "break.start" ? { minutes: 5 } : {}));
      h1.close();

      const h2 = await harness(local, factory, T0 + MIN);
      const ports = fakePorts();
      for (const [n, spec] of p1.alarms.live) ports.alarms.live.set(n, spec); // alarms survive in Chrome
      ports.notifications.live.set("fb.start.sess1", { title: "t", message: "m" });
      ports.action.badge = "ON";
      const engine = engineFor(h2, ports, { safeMode: true, notices: SAFE });
      expect((await engine.enqueue({ kind: "startup" })).ok).toBe(true);
      expect(await h2.repos.active.get()).toEqual({ none: true });
      expect(ports.alarms.live.size).toBe(0);
      expect(ports.notifications.live.size).toBe(0);
      expect(ports.action.badge).toBe("");
      expect(await h2.repos.sessions?.get("sess1")).toBeNull();
      expect(await diagCodes(h2)).toContain("E_SAFE_MODE_SESSION_ENDED");
      expect(ports.snapshot.published.at(-1)).toMatchObject({ session: null, notices: SAFE });
      // The next boot's raw purge clears the session's segments (no valid session.active).
      await h2.repos.segments?.append(segment({ sessionId: "sess1", seq: 0 }));
      h2.close();
      const h3 = await harness(local, factory, T0 + 2 * MIN);
      expect(await h3.repos.segments?.count("sess1")).toBe(0);
    },
  );

  it("an ENDING session found at boot is ended the same way, without a summary", async () => {
    const h = await harness();
    const engine = engineFor(h, fakePorts());
    await engine.enqueue(command("session.start", startDraft));
    const read = (await h.repos.active.get()) as { state: ActiveState };
    await h.repos.active.put({
      ...read.state,
      session: { ...read.state.session, state: "ENDING", ending: { endReason: "user_stop", endedAt: T0 } },
    });
    await engineFor(h, fakePorts(), { safeMode: true }).enqueue({ kind: "startup" });
    expect(await h.repos.active.get()).toEqual({ none: true });
    expect(await h.repos.sessions?.get("sess1")).toBeNull();
  });

  it("prefs.get and diag.get keep working; ticks and alarms are harmless", async () => {
    const h = await harness();
    const engine = engineFor(h, fakePorts(), { safeMode: true, notices: SAFE });
    await engine.enqueue({ kind: "startup" });
    await h.repos.diag.append("E_SOME_CODE");
    const { createRouter } = await import("../../../src/shell/messaging/router");
    const id = "z".repeat(32);
    const router = createRouter({
      runtimeId: id,
      getURL: (p) => `chrome-extension://${id}/${p}`,
      engine: () => Promise.resolve(engine),
    });
    const sender = { id, url: `chrome-extension://${id}/sidepanel.html` };
    const prefs = await router.handle({ v: 1, id: "a", type: "prefs.get", payload: {} }, sender);
    expect(prefs).toMatchObject({ ok: true, data: { prefs: { schemaVersion: 1 } } });
    expect(await router.handle({ v: 1, id: "b", type: "diag.get", payload: {} }, sender)).toMatchObject({
      ok: true,
      data: { entries: expect.arrayContaining([expect.objectContaining({ code: "E_SOME_CODE" })]) as unknown },
    });
    expect(await router.handle({ v: 1, id: "c", type: "session.start", payload: startDraft }, sender)).toEqual({
      id: "c",
      ok: false,
      error: "storage_error",
    });
    expect((await engine.enqueue({ kind: "tick" })).ok).toBe(true);
    expect((await engine.enqueue({ kind: "alarm", name: "fb.sessionEnd" })).ok).toBe(true);
  });
});
