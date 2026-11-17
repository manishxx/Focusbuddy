// Reconciliation (Startup input), ARCHITECTURE §4 and §5.1.1 "Reconciliation (Day 07 scope)".
import { describe, expect, it } from "vitest";
import type { Effect } from "../../../src/core/session/types";
import type { ActiveState } from "../../../src/core/types";
import {
  alarmsCleared,
  alarmsScheduled,
  badge,
  cmd,
  MIN,
  notifications,
  run,
  scheduled,
  started,
  T0,
  title,
  valid,
} from "./helpers";

const ALL = ["fb.tick", "fb.sessionEnd", "fb.breakEnd", "fb.breakPrompt", "fb.stalePause"];
const startup = { kind: "startup" as const };
const summaries = (fx: Effect[]) => fx.filter((e) => e.type === "BuildSummaryAndPurgeRaw");

describe("Startup: no session", () => {
  it("clears every alarm, badge none, tooltip.none, snapshot", () => {
    const r = run(null, startup, T0);
    expect(r.state).toBeNull();
    expect(alarmsCleared(r.effects).sort()).toEqual([...ALL].sort());
    expect(badge(r.effects)).toEqual({ type: "SetBadge", text: "" });
    expect(title(r.effects)).toMatchObject({ key: "tooltip.none" });
    expect(r.effects.at(-1)).toEqual({ type: "PublishSnapshot" });
  });
});

describe("Startup: corrupt session.active", () => {
  it("ends it with no summary (stale_pause, DATA_MODEL §8): state null, diag, cleanup", () => {
    const r = run(null, { kind: "startup", corrupt: true }, T0);
    expect(r.state).toBeNull();
    expect(r.effects[0]).toEqual({ type: "Diag", code: "E_ACTIVE_CORRUPT_ENDED" });
    expect(summaries(r.effects)).toEqual([]);
    expect(alarmsCleared(r.effects)).toHaveLength(5);
  });
});

describe("Startup: ENDING", () => {
  it("finishes the ending: the same summary + cleanup effects, idempotently", () => {
    const ending = valid(run(started(), cmd("session.stop"), T0 + 10 * MIN));
    const r1 = run(ending, startup, T0 + 20 * MIN);
    expect(r1.state).toEqual(ending);
    expect(summaries(r1.effects)).toEqual([
      { type: "BuildSummaryAndPurgeRaw", sessionId: "s1", endReason: "user_stop", endedAt: T0 + 10 * MIN },
    ]);
    const r2 = run(ending, startup, T0 + 30 * MIN);
    expect(r2.effects).toEqual(r1.effects);
    expect(notifications(r1.effects)).toEqual([]);
  });
});

describe("Startup: ACTIVE", () => {
  it("expired while closed (endsAt ≤ now) → ENDING expired_while_closed at the natural end; gap up to the end is away", () => {
    const st = { ...started(), lastSeenAt: T0 + 20 * MIN };
    const r = run(st, startup, T0 + 90 * MIN);
    const next = valid(r);
    expect(next.session.ending).toEqual({ endReason: "expired_while_closed", endedAt: T0 + 60 * MIN });
    expect(next.awayMs).toBe(40 * MIN);
    expect(next.session.pauses).toEqual([]);
    expect(summaries(r.effects)).toHaveLength(1);
  });

  it("gap 1 min: ignored entirely; alarms are still re-created", () => {
    const st = { ...started(), lastSeenAt: T0 + 10 * MIN };
    const r = run(st, startup, T0 + 11 * MIN);
    expect(r.state).toEqual(st);
    expect(scheduled(r.effects, "fb.sessionEnd")?.when).toBe(T0 + 60 * MIN);
    expect(scheduled(r.effects, "fb.tick")?.periodMin).toBe(0.5);
    expect(alarmsCleared(r.effects).sort()).toEqual(["fb.breakEnd", "fb.breakPrompt", "fb.stalePause"]);
  });

  it("gap 5 min: counts as session time and as away (awayMs), no pause, no prompt", () => {
    const st = { ...started(), lastSeenAt: T0 + 10 * MIN };
    const r = run(st, startup, T0 + 15 * MIN);
    const next = valid(r);
    expect(next.session.state).toBe("ACTIVE");
    expect(next.session.pauses).toEqual([]);
    expect(next.awayMs).toBe(5 * MIN);
    expect(next.lastSeenAt).toBe(T0 + 15 * MIN);
    // The gap was session time: the end doesn't move.
    expect(scheduled(r.effects, "fb.sessionEnd")?.when).toBe(T0 + 60 * MIN);
    expect(alarmsScheduled(r.effects)).toEqual(["fb.sessionEnd", "fb.tick"]);
    expect(badge(r.effects)).toMatchObject({ text: "ON" });
    expect(notifications(r.effects)).toEqual([]);
  });

  it("gap 10 min: awayMs, then auto-pause at now with the continue prompt shown once", () => {
    const st = { ...started(), lastSeenAt: T0 + 10 * MIN };
    const r = run(st, startup, T0 + 20 * MIN);
    const next = valid(r);
    expect(next.awayMs).toBe(10 * MIN);
    expect(next.session).toMatchObject({ state: "PAUSED", awaitingContinue: true, awaySince: T0 + 10 * MIN });
    expect(next.session.pauses).toEqual([{ from: T0 + 20 * MIN, kind: "auto_absent" }]);
    expect(next.notified.continuePrompt).toBe(T0 + 20 * MIN);
    expect(notifications(r.effects)).toEqual([
      {
        type: "ShowNotification",
        id: "fb.continue.s1",
        titleKey: "continue.title",
        bodyKey: "continue.body",
        vars: {},
        generic: false,
      },
    ]);
    expect(alarmsScheduled(r.effects)).toEqual(["fb.stalePause"]);
    expect(scheduled(r.effects, "fb.stalePause")?.when).toBe(T0 + 260 * MIN);
    expect(badge(r.effects)).toMatchObject({ text: "II" });
    expect(title(r.effects)).toMatchObject({ key: "tooltip.awaitingContinue" });
    // Frozen at the remaining time at now: 60 − 20 = 40 min left.
    // A second Startup (and returning to the machine) shows nothing more.
    const again = run(next, startup, T0 + 21 * MIN);
    expect(again.state).toEqual(next);
    expect(notifications(again.effects)).toEqual([]);
    const active = run(next, { kind: "idle", state: "active", at: T0 + 22 * MIN }, T0 + 22 * MIN);
    expect(notifications(active.effects)).toEqual([]);
    const back = valid(run(next, cmd("session.continue"), T0 + 30 * MIN));
    expect(scheduled(run(back, startup, T0 + 30 * MIN).effects, "fb.sessionEnd")?.when).toBe(T0 + 70 * MIN);
  });

  it("gap beyond the session's end → expired_while_closed, no auto-pause, no prompt", () => {
    const st = { ...started(), lastSeenAt: T0 + 55 * MIN };
    const r = run(st, startup, T0 + 200 * MIN);
    const next = valid(r);
    expect(next.session.ending?.endReason).toBe("expired_while_closed");
    expect(next.awayMs).toBe(5 * MIN);
    expect(notifications(r.effects)).toEqual([]);
  });

  it("double Startup is idempotent: awayMs counted once, no notifications, no summaries", () => {
    const st = { ...started(), lastSeenAt: T0 + 10 * MIN };
    const first = valid(run(st, startup, T0 + 15 * MIN));
    expect(first.awayMs).toBe(5 * MIN);
    const second = run(first, startup, T0 + 15 * MIN + 1_000);
    expect(second.state).toEqual(first);
    expect(notifications(second.effects)).toEqual([]);
    expect(summaries(second.effects)).toEqual([]);
  });

  it("never re-shows the start notification (AC-02)", () => {
    const st = started();
    expect(notifications(run(st, startup, T0 + 5_000).effects)).toEqual([]);
  });
});

describe("Startup: PAUSED", () => {
  it("a pause over 4 h → ENDING stale_pause", () => {
    const p = valid(run(started(), cmd("session.pause"), T0 + 10 * MIN));
    const r = run(p, startup, T0 + 300 * MIN);
    expect(valid(r).session.ending?.endReason).toBe("stale_pause");
    expect(summaries(r.effects)).toHaveLength(1);
  });
  it("otherwise re-creates fb.stalePause only; the open pause covers the gap (no auto_absent)", () => {
    const p = valid(run(started(), cmd("session.pause"), T0 + 10 * MIN));
    const r = run(p, startup, T0 + 100 * MIN);
    expect(r.state).toEqual(p);
    expect(alarmsScheduled(r.effects)).toEqual(["fb.stalePause"]);
    expect(scheduled(r.effects, "fb.stalePause")?.when).toBe(T0 + 250 * MIN);
    expect(badge(r.effects)).toMatchObject({ text: "II" });
  });
});

describe("Startup: ON_BREAK", () => {
  const onBreak = (): ActiveState => valid(run(started(), cmd("break.start", { minutes: 10 }), T0 + 10 * MIN));
  it("break not over yet: re-creates fb.breakEnd", () => {
    const r = run(onBreak(), startup, T0 + 12 * MIN);
    expect(alarmsScheduled(r.effects)).toEqual(["fb.stalePause", "fb.breakEnd"]);
    expect(scheduled(r.effects, "fb.stalePause")?.when).toBe(T0 + 250 * MIN);
    expect(scheduled(r.effects, "fb.breakEnd")?.when).toBe(T0 + 20 * MIN);
    expect(badge(r.effects)).toMatchObject({ text: "BRK" });
  });
  it("break-over shown, repeat pending: re-creates fb.breakPrompt; no notification replay", () => {
    const over = valid(run(onBreak(), { kind: "alarm", name: "fb.breakEnd" }, T0 + 20 * MIN));
    const r = run(over, startup, T0 + 22 * MIN);
    expect(alarmsScheduled(r.effects)).toEqual(["fb.stalePause", "fb.breakPrompt"]);
    expect(scheduled(r.effects, "fb.breakPrompt")?.when).toBe(T0 + 25 * MIN);
    expect(notifications(r.effects)).toEqual([]);
  });
  it("both prompts shown: only fb.stalePause", () => {
    const over = valid(run(onBreak(), { kind: "alarm", name: "fb.breakEnd" }, T0 + 20 * MIN));
    const rep = valid(run(over, { kind: "alarm", name: "fb.breakPrompt" }, T0 + 25 * MIN));
    expect(alarmsScheduled(run(rep, startup, T0 + 26 * MIN).effects)).toEqual(["fb.stalePause"]);
  });
});
