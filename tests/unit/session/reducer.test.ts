// ARCHITECTURE §5.1.1: one block per transition-table row (accept, guard-reject,
// effects and alarms), plus payload validation and the shared ENDING behaviour.
import { describe, expect, it } from "vitest";
import { BADGE_COLORS } from "../../../src/core/session/present";
import { ALARM_SLACK_MS } from "../../../src/core/session/reducer";
import { endsAt, remainingMs } from "../../../src/core/session/time";
import type { ActiveState } from "../../../src/core/types";
import {
  alarmsCleared,
  alarmsScheduled,
  badge,
  cmd,
  draft,
  MIN,
  notifications,
  run,
  scheduled,
  started,
  T0,
  title,
  types,
  valid,
} from "./helpers";

const ALL = ["fb.tick", "fb.sessionEnd", "fb.breakEnd", "fb.breakPrompt", "fb.stalePause"];

function paused(at = T0 + 10 * MIN): ActiveState {
  return valid(run(started(), cmd("session.pause"), at));
}
function onBreak(at = T0 + 10 * MIN, minutes = 10): ActiveState {
  return valid(run(started(), cmd("break.start", { minutes }), at));
}
function autoPaused(): ActiveState {
  const locked = valid(run(started(), { kind: "idle", state: "locked", at: T0 + 5 * MIN }, T0 + 5 * MIN));
  return valid(run(locked, { kind: "tick" }, T0 + 15 * MIN));
}

function expectEnding(r: ReturnType<typeof run>, reason: string) {
  const st = valid(r);
  expect(st.session.state).toBe("ENDING");
  expect(st.session.ending?.endReason).toBe(reason);
  expect(st.session.pauses.every((p) => p.to !== undefined)).toBe(true);
  expect(r.effects[0]).toMatchObject({ type: "BuildSummaryAndPurgeRaw", sessionId: st.session.id, endReason: reason });
  expect(alarmsCleared(r.effects).sort()).toEqual([...ALL].sort());
  expect(r.effects.filter((e) => e.type === "ClearNotification").map((e) => (e as { id: string }).id)).toEqual([
    `fb.start.${st.session.id}`,
    `fb.continue.${st.session.id}`,
    `fb.break.${st.session.id}`,
  ]);
  expect(badge(r.effects)).toEqual({ type: "SetBadge", text: "" });
  expect(title(r.effects)).toMatchObject({ key: "tooltip.none" });
  expect(r.effects.at(-1)).toEqual({ type: "PublishSnapshot" });
  return st;
}

describe("row: none + session.start", () => {
  it("creates an ACTIVE session with alarms, start notification, badge, title, snapshot", () => {
    const r = run(null, cmd("session.start", { draft: draft() }), T0);
    const st = valid(r);
    expect(r.data).toEqual({ sessionId: "s1" });
    expect(st.session).toMatchObject({ id: "s1", state: "ACTIVE", startedAt: T0, plannedMin: 60, extensionsMin: 0 });
    expect(st.session.mode).toBe("gentle");
    expect(st).toMatchObject({
      attention: "ACTIVE_INPUT",
      attentionSince: T0,
      lastSeenAt: T0,
      notified: { start: T0 },
    });
    expect(scheduled(r.effects, "fb.sessionEnd")?.when).toBe(T0 + 60 * MIN);
    expect(scheduled(r.effects, "fb.tick")?.periodMin).toBe(0.5);
    const [n] = notifications(r.effects);
    expect(n).toEqual({
      type: "ShowNotification",
      id: "fb.start.s1",
      titleKey: "start.title",
      bodyKey: "start.body",
      vars: { task: "Write report", planned: { kind: "duration", ms: 60 * MIN } },
      generic: false,
    });
    expect(badge(r.effects)).toEqual({ type: "SetBadge", text: "ON", color: BADGE_COLORS.on });
    expect(title(r.effects)).toMatchObject({ key: "tooltip.active", vars: { task: "Write report" } });
    expect(r.effects.at(-1)).toEqual({ type: "PublishSnapshot" });
  });

  it("private notifications: generic body and tooltip, no task label", () => {
    const r = run(null, cmd("session.start", { draft: draft() }), T0, { privateNotifications: true });
    const [n] = notifications(r.effects);
    expect(n).toMatchObject({ bodyKey: "start.body.generic", vars: {}, generic: true });
    expect(title(r.effects)).toMatchObject({ key: "tooltip.active.generic" });
    expect(JSON.stringify(r.effects)).not.toContain("Write report");
  });

  it("uses the draft's mode when given, else prefs.defaultMode", () => {
    expect(valid(run(null, cmd("session.start", { draft: draft({ mode: "strict" }) }), T0)).session.mode).toBe(
      "strict",
    );
    const noNext: Record<string, unknown> = draft();
    delete noNext.nextStep;
    expect(
      valid(run(null, cmd("session.start", { draft: noNext }), T0, { defaultMode: "adaptive" })).session.mode,
    ).toBe("adaptive");
  });

  it.each([
    ["missing draft", {}],
    ["unknown key", { draft: draft({ title: "x" }) }],
    ["empty task label", { draft: draft({ taskLabel: "" }) }],
    ["plannedMin too small", { draft: draft({ plannedMin: 4 }) }],
    ["plannedMin too large", { draft: draft({ plannedMin: 481 }) }],
    ["bad mode", { draft: draft({ mode: "chaos" }) }],
    ["www host", { draft: draft({ allowedHosts: ["www.example.com"] }) }],
    ["keyword over 60", { draft: draft({ keywords: ["k".repeat(61)] }) }],
    ["extra payload key", { draft: draft(), x: 1 }],
    ["not an object", "start"],
    ["getter", Object.defineProperty({}, "draft", { get: () => draft(), enumerable: true })],
  ])("guard: invalid draft (%s) → invalid_message, nothing changes", (_name, payload) => {
    const r = run(null, cmd("session.start", payload), T0);
    expect(r).toEqual({ state: null, effects: [], error: "invalid_message" });
  });

  it("guard: a bad injected id → internal", () => {
    const r = run(null, cmd("session.start", { draft: draft() }), T0, { newId: () => "bad id!" });
    expect(r.error).toBe("internal");
    expect(r.state).toBeNull();
  });
});

describe("row: any active + session.start", () => {
  it.each([
    ["ACTIVE", () => started()],
    ["PAUSED", () => paused()],
    ["ON_BREAK", () => onBreak()],
  ])("%s → invalid_state {activeSessionId}, unchanged (AC-29)", (_n, make) => {
    const st = make();
    const r = run(st, cmd("session.start", { draft: draft() }), T0 + 20 * MIN);
    expect(r).toEqual({ state: st, effects: [], error: "invalid_state", data: { activeSessionId: "s1" } });
  });
});

describe("row: ACTIVE + session.pause", () => {
  it("opens a pause, clears tick + sessionEnd, sets stalePause (+4 h), drift ON_TASK, badge II", () => {
    const r = run(started(), cmd("session.pause"), T0 + 10 * MIN);
    const st = valid(r);
    expect(st.session.state).toBe("PAUSED");
    expect(st.session.pauses).toEqual([{ from: T0 + 10 * MIN, kind: "pause" }]);
    expect(alarmsCleared(r.effects)).toEqual(["fb.tick", "fb.sessionEnd"]);
    expect(scheduled(r.effects, "fb.stalePause")?.when).toBe(T0 + 10 * MIN + 240 * MIN);
    expect(st.drift).toEqual({ phase: "ON_TASK", since: T0 + 10 * MIN, accumulatedMs: 0 });
    expect(badge(r.effects)).toEqual({ type: "SetBadge", text: "II", color: BADGE_COLORS.slate });
    expect(title(r.effects)).toMatchObject({ key: "tooltip.paused", vars: { task: "Write report" } });
    expect(endsAt(st.session, T0 + 99 * MIN)).toBe(T0 + 60 * MIN); // frozen
  });
  it("generic tooltip when private", () => {
    const r = run(started(), cmd("session.pause"), T0 + MIN, { privateNotifications: true });
    expect(title(r.effects)).toMatchObject({ key: "tooltip.paused.generic", vars: {} });
  });
  it("idempotent when already PAUSED", () => {
    const st = paused();
    expect(run(st, cmd("session.pause"), T0 + 11 * MIN)).toEqual({ state: st, effects: [] });
  });
  it("guard: ON_BREAK → invalid_state; no session → invalid_state", () => {
    const st = onBreak();
    expect(run(st, cmd("session.pause"), T0 + 11 * MIN)).toMatchObject({ state: st, error: "invalid_state" });
    expect(run(null, cmd("session.pause"), T0)).toMatchObject({ state: null, error: "invalid_state" });
  });
  it("guard: payload must be {}", () => {
    expect(run(started(), cmd("session.pause", { x: 1 }), T0).error).toBe("invalid_message");
  });
});

describe("row: PAUSED + session.resume", () => {
  it("closes the pause, re-sets sessionEnd + tick, clears stalePause, badge ON", () => {
    const r = run(paused(), cmd("session.resume"), T0 + 30 * MIN);
    const st = valid(r);
    expect(st.session.state).toBe("ACTIVE");
    expect(st.session.pauses).toEqual([{ from: T0 + 10 * MIN, to: T0 + 30 * MIN, kind: "pause" }]);
    expect(scheduled(r.effects, "fb.sessionEnd")?.when).toBe(T0 + 80 * MIN);
    expect(scheduled(r.effects, "fb.tick")?.periodMin).toBe(0.5);
    expect(alarmsCleared(r.effects)).toContain("fb.stalePause");
    expect(badge(r.effects)).toMatchObject({ text: "ON" });
    expect(st.attention).toBe("ACTIVE_INPUT");
    expect(st.attentionSince).toBe(T0 + 30 * MIN);
  });
  it("guard: awaitingContinue → invalid_state (use session.continue)", () => {
    const st = autoPaused();
    expect(run(st, cmd("session.resume"), T0 + 16 * MIN)).toMatchObject({ state: st, error: "invalid_state" });
  });
  it("idempotent when ACTIVE; invalid on ON_BREAK", () => {
    const a = started();
    expect(run(a, cmd("session.resume"), T0 + MIN)).toEqual({ state: a, effects: [] });
    expect(run(onBreak(), cmd("session.resume"), T0 + 11 * MIN).error).toBe("invalid_state");
  });
});

describe("row: PAUSED · awaitingContinue + session.continue", () => {
  it("as resume, plus clears awaitingContinue/awaySince and the continue notification", () => {
    const r = run(autoPaused(), cmd("session.continue"), T0 + 20 * MIN);
    const st = valid(r);
    expect(st.session.state).toBe("ACTIVE");
    expect(st.session.awaitingContinue).toBeUndefined();
    expect(st.session.awaySince).toBeUndefined();
    expect(st.session.pauses).toEqual([{ from: T0 + 5 * MIN, to: T0 + 20 * MIN, kind: "auto_absent" }]);
    expect(r.effects).toContainEqual({ type: "ClearNotification", id: "fb.continue.s1" });
    expect(alarmsScheduled(r.effects)).toEqual(["fb.sessionEnd", "fb.tick"]);
    expect(st.attention).toBe("ACTIVE_INPUT");
  });
  it("guard: PAUSED without awaitingContinue → invalid_state; ACTIVE → no-op", () => {
    expect(run(paused(), cmd("session.continue"), T0 + 11 * MIN).error).toBe("invalid_state");
    const a = started();
    expect(run(a, cmd("session.continue"), T0 + MIN)).toEqual({ state: a, effects: [] });
  });
});

describe("row: ACTIVE + break.start", () => {
  it("opens a break pause, breakEndsAt = now + minutes, alarms breakEnd, clears tick, badge BRK", () => {
    const r = run(started(), cmd("break.start", { minutes: 10 }), T0 + 10 * MIN);
    const st = valid(r);
    expect(st.session.state).toBe("ON_BREAK");
    expect(st.session.pauses).toEqual([{ from: T0 + 10 * MIN, kind: "break" }]);
    expect(st.session.breakEndsAt).toBe(T0 + 20 * MIN);
    expect(scheduled(r.effects, "fb.breakEnd")?.when).toBe(T0 + 20 * MIN);
    expect(scheduled(r.effects, "fb.stalePause")?.when).toBe(T0 + 250 * MIN);
    expect(alarmsCleared(r.effects)).toContain("fb.tick");
    expect(badge(r.effects)).toEqual({ type: "SetBadge", text: "BRK", color: BADGE_COLORS.slate });
    expect(title(r.effects)).toMatchObject({
      key: "tooltip.break",
      vars: { time: { kind: "clock", at: T0 + 20 * MIN } },
    });
  });
  it("BR-2: capped at now + remaining", () => {
    const st = valid(run(started(), cmd("break.start", { minutes: 60 }), T0 + 55 * MIN));
    expect(st.session.breakEndsAt).toBe(T0 + 60 * MIN);
  });
  it("guards: minutes 1–60; only from ACTIVE", () => {
    for (const m of [0, 61, 1.5, "5"])
      expect(run(started(), cmd("break.start", { minutes: m }), T0).error).toBe("invalid_message");
    expect(run(paused(), cmd("break.start", { minutes: 5 }), T0 + 11 * MIN).error).toBe("invalid_state");
    expect(run(onBreak(), cmd("break.start", { minutes: 5 }), T0 + 11 * MIN).error).toBe("invalid_state");
    expect(run(null, cmd("break.start", { minutes: 5 }), T0).error).toBe("invalid_state");
  });
  it("the session clock is stopped during the break", () => {
    const st = onBreak();
    expect(remainingMs(st.session, T0 + 10 * MIN)).toBe(50 * MIN);
    expect(remainingMs(st.session, T0 + 300 * MIN)).toBe(50 * MIN);
  });
});

describe("row: ON_BREAK + break.end (user path)", () => {
  it("closes the pause and resumes; clears breakEnd/breakPrompt and the break notification", () => {
    const r = run(onBreak(), cmd("break.end"), T0 + 15 * MIN);
    const st = valid(r);
    expect(st.session.state).toBe("ACTIVE");
    expect(st.session.breakEndsAt).toBeUndefined();
    expect(scheduled(r.effects, "fb.sessionEnd")?.when).toBe(T0 + 65 * MIN);
    expect(alarmsCleared(r.effects)).toEqual(expect.arrayContaining(["fb.breakEnd", "fb.breakPrompt"]));
    expect(r.effects).toContainEqual({ type: "ClearNotification", id: "fb.break.s1" });
  });
  it("idempotent when ACTIVE; invalid when PAUSED", () => {
    const a = started();
    expect(run(a, cmd("break.end"), T0 + MIN)).toEqual({ state: a, effects: [] });
    expect(run(paused(), cmd("break.end"), T0 + 11 * MIN).error).toBe("invalid_state");
  });
});

describe("row: ON_BREAK + alarm fb.breakEnd", () => {
  it("stays ON_BREAK, shows break-over once, sets breakPrompt +5 min; clock stays stopped", () => {
    const r = run(onBreak(), { kind: "alarm", name: "fb.breakEnd" }, T0 + 20 * MIN);
    const st = valid(r);
    expect(st.session.state).toBe("ON_BREAK");
    expect(st.notified.breakOver).toBe(T0 + 20 * MIN);
    expect(notifications(r.effects)).toEqual([
      {
        type: "ShowNotification",
        id: "fb.break.s1",
        titleKey: "break.over.title",
        bodyKey: "break.over.body",
        vars: { task: "Write report" },
        generic: false,
      },
    ]);
    expect(scheduled(r.effects, "fb.breakPrompt")?.when).toBe(T0 + 25 * MIN);
    expect(remainingMs(st.session, T0 + 200 * MIN)).toBe(50 * MIN);
    // Replayed alarm (e.g. after restart): no second notification.
    expect(notifications(run(st, { kind: "alarm", name: "fb.breakEnd" }, T0 + 21 * MIN).effects)).toEqual([]);
  });
  it("generic body when private", () => {
    const r = run(onBreak(), { kind: "alarm", name: "fb.breakEnd" }, T0 + 20 * MIN, { privateNotifications: true });
    expect(notifications(r.effects)[0]).toMatchObject({ bodyKey: "break.over.body.generic", vars: {}, generic: true });
  });
  it("outside ON_BREAK: clears the stray alarm", () => {
    expect(run(started(), { kind: "alarm", name: "fb.breakEnd" }, T0 + MIN).effects).toEqual([
      { type: "ClearAlarm", name: "fb.breakEnd" },
    ]);
  });
});

describe("row: ON_BREAK + alarm fb.breakPrompt (BR-3)", () => {
  it("repeats once, then nothing more", () => {
    const over = valid(run(onBreak(), { kind: "alarm", name: "fb.breakEnd" }, T0 + 20 * MIN));
    const r1 = run(over, { kind: "alarm", name: "fb.breakPrompt" }, T0 + 25 * MIN);
    const st = valid(r1);
    expect(notifications(r1.effects)).toHaveLength(1);
    expect(st.notified.breakRepeat).toBe(T0 + 25 * MIN);
    const r2 = run(st, { kind: "alarm", name: "fb.breakPrompt" }, T0 + 30 * MIN);
    expect(r2).toEqual({ state: st, effects: [] });
  });
  it("no repeat before the first prompt; stray alarm outside ON_BREAK is cleared", () => {
    const st = onBreak();
    expect(run(st, { kind: "alarm", name: "fb.breakPrompt" }, T0 + 12 * MIN)).toEqual({ state: st, effects: [] });
    expect(run(started(), { kind: "alarm", name: "fb.breakPrompt" }, T0).effects).toEqual([
      { type: "ClearAlarm", name: "fb.breakPrompt" },
    ]);
  });
});

describe("row: ON_BREAK + break.extend", () => {
  it("adds minutes, re-arms breakEnd, resets the BR-3 repeat", () => {
    const over = valid(run(onBreak(), { kind: "alarm", name: "fb.breakEnd" }, T0 + 20 * MIN));
    const r = run(over, cmd("break.extend", { minutes: 5 }), T0 + 21 * MIN);
    const st = valid(r);
    // The old end has passed, so the extension counts from now.
    expect(st.session.breakEndsAt).toBe(T0 + 26 * MIN);
    expect(st.notified.breakOver).toBeUndefined();
    expect(st.notified.breakRepeat).toBeUndefined();
    expect(scheduled(r.effects, "fb.breakEnd")?.when).toBe(T0 + 26 * MIN);
    expect(scheduled(r.effects, "fb.stalePause")?.when).toBe(T0 + 250 * MIN); // re-armed from the break start
    expect(alarmsCleared(r.effects)).toContain("fb.breakPrompt");
    // A new break-over prompt can be shown for the extended break.
    expect(notifications(run(st, { kind: "alarm", name: "fb.breakEnd" }, T0 + 26 * MIN).effects)).toHaveLength(1);
  });
  it("from the planned end while it's still ahead; capped at the session end", () => {
    const st = valid(run(onBreak(), cmd("break.extend", { minutes: 15 }), T0 + 12 * MIN));
    expect(st.session.breakEndsAt).toBe(T0 + 35 * MIN);
    const late = valid(run(started(), cmd("break.start", { minutes: 5 }), T0 + 54 * MIN));
    expect(valid(run(late, cmd("break.extend", { minutes: 15 }), T0 + 55 * MIN)).session.breakEndsAt).toBe(
      T0 + 61 * MIN,
    );
  });
  it("guards: minutes 1–15; only ON_BREAK", () => {
    expect(run(onBreak(), cmd("break.extend", { minutes: 16 }), T0 + 11 * MIN).error).toBe("invalid_message");
    expect(run(started(), cmd("break.extend", { minutes: 5 }), T0).error).toBe("invalid_state");
  });
});

describe("row: ACTIVE / PAUSED / ON_BREAK + session.extend", () => {
  it("ACTIVE: extensionsMin += minutes and re-arms sessionEnd", () => {
    const r = run(started(), cmd("session.extend", { minutes: 15 }), T0 + 10 * MIN);
    const st = valid(r);
    expect(st.session.extensionsMin).toBe(15);
    expect(scheduled(r.effects, "fb.sessionEnd")?.when).toBe(T0 + 75 * MIN);
  });
  it("PAUSED and ON_BREAK: no sessionEnd re-arm", () => {
    for (const st of [paused(), onBreak()]) {
      const r = run(st, cmd("session.extend", { minutes: 5 }), T0 + 11 * MIN);
      expect(valid(r).session.extensionsMin).toBe(5);
      expect(scheduled(r.effects, "fb.sessionEnd")).toBeUndefined();
    }
  });
  it("over the 480-min cap: clamps and replies {cappedAt}; at the cap: no change, ok {cappedAt} (D-022)", () => {
    const big = started(T0, { plannedMin: 400 });
    const exact = run(big, cmd("session.extend", { minutes: 80 }), T0 + MIN);
    expect(exact.error).toBeUndefined();
    expect(exact.data).toBeUndefined();
    const r = run(big, cmd("session.extend", { minutes: 85 }), T0 + MIN);
    const st = valid(r);
    expect(st.session.extensionsMin).toBe(80);
    expect(r.data).toEqual({ cappedAt: T0 + 480 * MIN });
    expect(scheduled(r.effects, "fb.sessionEnd")?.when).toBe(T0 + 480 * MIN);
    const again = run(st, cmd("session.extend", { minutes: 5 }), T0 + 2 * MIN);
    expect(again).toEqual({ state: st, effects: [], data: { cappedAt: T0 + 480 * MIN } });
    const pausedBig = valid(run(big, cmd("session.pause"), T0 + 10 * MIN));
    const p = run(pausedBig, cmd("session.extend", { minutes: 120 }), T0 + 20 * MIN);
    expect(p.data).toEqual({ cappedAt: T0 + 480 * MIN });
    expect(scheduled(p.effects, "fb.sessionEnd")).toBeUndefined();
  });
  it("guard: minutes outside 5–120 → invalid_message; no session → invalid_state", () => {
    const big = started(T0, { plannedMin: 400 });
    expect(run(big, cmd("session.extend", { minutes: 4 }), T0).error).toBe("invalid_message");
    expect(run(big, cmd("session.extend", { minutes: 121 }), T0).error).toBe("invalid_message");
    expect(run(null, cmd("session.extend", { minutes: 5 }), T0).error).toBe("invalid_state");
  });
});

describe("row: ACTIVE / PAUSED / ON_BREAK + session.updateNote", () => {
  it("updates objective and nextStep, publishes the snapshot", () => {
    const r = run(paused(), cmd("session.updateNote", { objective: "New goal", nextStep: "" }), T0 + 11 * MIN);
    const st = valid(r);
    expect(st.session.objective).toBe("New goal");
    expect(st.session.nextStep).toBe("");
    expect(r.effects).toEqual([{ type: "PublishSnapshot" }]);
  });
  it("guards: length caps, unknown keys, no session", () => {
    expect(run(started(), cmd("session.updateNote", { objective: "x".repeat(301) }), T0).error).toBe("invalid_message");
    expect(run(started(), cmd("session.updateNote", { nextStep: "x".repeat(501) }), T0).error).toBe("invalid_message");
    expect(run(started(), cmd("session.updateNote", { taskLabel: "x" }), T0).error).toBe("invalid_message");
    expect(run(null, cmd("session.updateNote", {}), T0).error).toBe("invalid_state");
  });
});

describe("row: ACTIVE + alarm fb.sessionEnd / any input with remainingMs = 0 → ENDING time_up", () => {
  it("alarm at the end time", () => {
    const st = expectEnding(run(started(), { kind: "alarm", name: "fb.sessionEnd" }, T0 + 60 * MIN), "time_up");
    expect(st.session.ending?.endedAt).toBe(T0 + 60 * MIN);
  });
  it("alarm within the slack also ends; earlier re-arms", () => {
    expectEnding(run(started(), { kind: "alarm", name: "fb.sessionEnd" }, T0 + 60 * MIN - ALARM_SLACK_MS), "time_up");
    const r = run(started(), { kind: "alarm", name: "fb.sessionEnd" }, T0 + 30 * MIN);
    expect(r.effects).toEqual([{ type: "ScheduleAlarm", name: "fb.sessionEnd", when: T0 + 60 * MIN }]);
  });
  it("a late tick ends it with endedAt at the natural end", () => {
    const st = expectEnding(run(started(), { kind: "tick" }, T0 + 61 * MIN), "time_up");
    expect(st.session.ending?.endedAt).toBe(T0 + 60 * MIN);
  });
  it("any command at remaining 0 ends the session instead", () => {
    expectEnding(run(started(), cmd("session.pause"), T0 + 60 * MIN), "time_up");
    expectEnding(run(started(), cmd("session.extend", { minutes: 5 }), T0 + 60 * MIN), "time_up");
    expectEnding(run(started(), cmd("break.start", { minutes: 5 }), T0 + 60 * MIN), "time_up");
    expectEnding(run(started(), cmd("session.updateNote", {}), T0 + 60 * MIN), "time_up");
    expectEnding(run(started(), { kind: "idle", state: "idle", at: T0 + 60 * MIN }, T0 + 60 * MIN), "time_up");
  });
  it("sessionEnd outside ACTIVE clears the stray alarm", () => {
    expect(run(paused(), { kind: "alarm", name: "fb.sessionEnd" }, T0 + 70 * MIN).effects).toEqual([
      { type: "ClearAlarm", name: "fb.sessionEnd" },
    ]);
  });
});

describe("row: ACTIVE / PAUSED / ON_BREAK + session.stop → ENDING user_stop", () => {
  it.each([
    ["ACTIVE", () => started()],
    ["PAUSED", () => paused()],
    ["ON_BREAK", () => onBreak()],
  ])("%s", (_n, make) => {
    const st = expectEnding(run(make(), cmd("session.stop"), T0 + 20 * MIN), "user_stop");
    expect(st.session.ending?.endedAt).toBe(T0 + 20 * MIN);
  });
  it("closes the open pause at endedAt", () => {
    const st = valid(run(onBreak(), cmd("session.stop"), T0 + 15 * MIN));
    expect(st.session.pauses).toEqual([{ from: T0 + 10 * MIN, to: T0 + 15 * MIN, kind: "break" }]);
  });
  it("no session → ok, nothing to do (idempotent); ENDING → invalid_state", () => {
    expect(run(null, cmd("session.stop"), T0)).toEqual({ state: null, effects: [] });
    const ending = valid(run(started(), cmd("session.stop"), T0 + MIN));
    expect(run(ending, cmd("session.stop"), T0 + 2 * MIN)).toMatchObject({ state: ending, error: "invalid_state" });
    expect(run(ending, cmd("session.pause"), T0 + 2 * MIN).error).toBe("invalid_state");
  });
});

describe("row: PAUSED + alarm fb.stalePause / open pause > 4 h → ENDING stale_pause", () => {
  it("alarm after 4 h", () => {
    expectEnding(run(paused(), { kind: "alarm", name: "fb.stalePause" }, T0 + 250 * MIN), "stale_pause");
  });
  it("any input after 4 h", () => {
    expectEnding(run(paused(), cmd("session.resume"), T0 + 251 * MIN), "stale_pause");
    expectEnding(run(paused(), { kind: "idle", state: "active", at: T0 + 251 * MIN }, T0 + 251 * MIN), "stale_pause");
  });
  it("early alarm re-arms; stray alarm outside PAUSED is cleared", () => {
    expect(run(paused(), { kind: "alarm", name: "fb.stalePause" }, T0 + 100 * MIN).effects).toEqual([
      { type: "ScheduleAlarm", name: "fb.stalePause", when: T0 + 250 * MIN },
    ]);
    expect(run(started(), { kind: "alarm", name: "fb.stalePause" }, T0).effects).toEqual([
      { type: "ClearAlarm", name: "fb.stalePause" },
    ]);
  });
});

describe("D-022: ON_BREAK open > 4 h → ENDING stale_pause", () => {
  it("alarm fb.stalePause after 4 h", () => {
    expectEnding(run(onBreak(), { kind: "alarm", name: "fb.stalePause" }, T0 + 250 * MIN), "stale_pause");
  });
  it("checked before every input", () => {
    expectEnding(run(onBreak(), cmd("break.end"), T0 + 251 * MIN), "stale_pause");
    expectEnding(run(onBreak(), cmd("break.extend", { minutes: 5 }), T0 + 251 * MIN), "stale_pause");
    expectEnding(run(onBreak(), { kind: "alarm", name: "fb.breakPrompt" }, T0 + 251 * MIN), "stale_pause");
    expectEnding(run(onBreak(), { kind: "tick" }, T0 + 251 * MIN), "stale_pause");
    expectEnding(run(onBreak(), { kind: "startup" }, T0 + 251 * MIN), "stale_pause");
  });
  it("an early alarm re-arms; before 4 h nothing ends", () => {
    expect(run(onBreak(), { kind: "alarm", name: "fb.stalePause" }, T0 + 100 * MIN).effects).toEqual([
      { type: "ScheduleAlarm", name: "fb.stalePause", when: T0 + 250 * MIN },
    ]);
    expect(valid(run(onBreak(), cmd("break.end"), T0 + 249 * MIN)).session.state).toBe("ACTIVE");
  });
});

describe("row: ACTIVE + IdleChanged", () => {
  it("records attention and attentionSince = the event's time", () => {
    const r = run(started(), { kind: "idle", state: "idle", at: T0 + 3 * MIN }, T0 + 3 * MIN + 500);
    const st = valid(r);
    expect(st.attention).toBe("IDLE");
    expect(st.attentionSince).toBe(T0 + 3 * MIN);
    expect(st.session.state).toBe("ACTIVE");
    expect(r.effects).toEqual([{ type: "PublishSnapshot" }]);
  });
  it("same attention again → no change; unknown idle state ignored; event time clamped to now", () => {
    const a = started();
    expect(run(a, { kind: "idle", state: "active", at: T0 + MIN }, T0 + MIN)).toEqual({ state: a, effects: [] });
    expect(run(a, { kind: "idle", state: "weird" as "idle", at: T0 }, T0)).toEqual({ state: a, effects: [] });
    expect(valid(run(a, { kind: "idle", state: "locked", at: T0 + 99 * MIN }, T0 + MIN)).attentionSince).toBe(T0 + MIN);
  });
  it("ignored on ON_BREAK, on PAUSED without awaitingContinue, and with no session", () => {
    const b = onBreak();
    expect(run(b, { kind: "idle", state: "locked", at: T0 + 11 * MIN }, T0 + 11 * MIN)).toEqual({
      state: b,
      effects: [],
    });
    const p = paused();
    expect(run(p, { kind: "idle", state: "active", at: T0 + 11 * MIN }, T0 + 11 * MIN)).toEqual({
      state: p,
      effects: [],
    });
    expect(run(null, { kind: "idle", state: "active", at: T0 }, T0)).toEqual({ state: null, effects: [] });
  });
});

describe("row: ACTIVE + Tick / IdleChanged with LOCKED ≥ 10 min or IDLE ≥ 30 min → auto-pause", () => {
  it("LOCKED ≥ 10 min: pause from attentionSince, awaitingContinue, badge II, no notification", () => {
    const locked = valid(run(started(), { kind: "idle", state: "locked", at: T0 + 5 * MIN }, T0 + 5 * MIN));
    const early = run(locked, { kind: "tick" }, T0 + 14 * MIN);
    expect(valid(early).session.state).toBe("ACTIVE");
    const r = run(locked, { kind: "tick" }, T0 + 15 * MIN);
    const st = valid(r);
    expect(st.session).toMatchObject({ state: "PAUSED", awaitingContinue: true, awaySince: T0 + 5 * MIN });
    expect(st.session.pauses).toEqual([{ from: T0 + 5 * MIN, kind: "auto_absent" }]);
    expect(notifications(r.effects)).toEqual([]);
    expect(badge(r.effects)).toMatchObject({ text: "II" });
    expect(title(r.effects)).toMatchObject({ key: "tooltip.awaitingContinue" });
    expect(scheduled(r.effects, "fb.stalePause")?.when).toBe(T0 + 245 * MIN);
    // The absence isn't session time: remaining is frozen at the value from attentionSince.
    expect(remainingMs(st.session, T0 + 15 * MIN)).toBe(55 * MIN);
  });
  it("IDLE ≥ 30 min via IdleChanged-time evaluation", () => {
    const idle = valid(run(started(), { kind: "idle", state: "idle", at: T0 + 5 * MIN }, T0 + 5 * MIN));
    expect(valid(run(idle, { kind: "tick" }, T0 + 34 * MIN)).session.state).toBe("ACTIVE");
    expect(valid(run(idle, { kind: "tick" }, T0 + 35 * MIN)).session.state).toBe("PAUSED");
    // A later IdleChanged (locked) re-times attention instead.
    const relocked = run(idle, { kind: "idle", state: "locked", at: T0 + 36 * MIN }, T0 + 36 * MIN);
    expect(valid(relocked).session.state).toBe("ACTIVE");
  });
  it("an absence longer than 4 h ends the session as stale_pause right away", () => {
    const locked = valid(
      run(started(T0, { plannedMin: 480 }), { kind: "idle", state: "locked", at: T0 + MIN }, T0 + MIN),
    );
    expectEnding(run(locked, { kind: "tick" }, T0 + 300 * MIN), "stale_pause");
  });
  it("never overlaps an earlier pause", () => {
    const st = started();
    const locked = valid(run(st, { kind: "idle", state: "locked", at: T0 + MIN }, T0 + MIN));
    // A crafted state whose pause ended after attentionSince.
    const crafted: ActiveState = {
      ...locked,
      session: { ...locked.session, pauses: [{ from: T0 + 2 * MIN, to: T0 + 4 * MIN, kind: "pause" }] },
    };
    const r = valid(run(crafted, { kind: "tick" }, T0 + 20 * MIN));
    expect(r.session.pauses[1]).toEqual({ from: T0 + 4 * MIN, kind: "auto_absent" });
  });
});

describe("row: PAUSED · awaitingContinue + IdleChanged{active}", () => {
  it("shows 'Continue your session?' once and republishes the snapshot", () => {
    const r = run(autoPaused(), { kind: "idle", state: "active", at: T0 + 16 * MIN }, T0 + 16 * MIN);
    const st = valid(r);
    expect(st.session.state).toBe("PAUSED");
    expect(st.notified.continuePrompt).toBe(T0 + 16 * MIN);
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
    expect(r.effects.at(-1)).toEqual({ type: "PublishSnapshot" });
    const again = run(st, { kind: "idle", state: "active", at: T0 + 17 * MIN }, T0 + 17 * MIN);
    expect(notifications(again.effects)).toEqual([]);
  });
  it("a new absence auto-pause can prompt again", () => {
    const prompted = valid(run(autoPaused(), { kind: "idle", state: "active", at: T0 + 16 * MIN }, T0 + 16 * MIN));
    const back = valid(run(prompted, cmd("session.continue"), T0 + 17 * MIN));
    const locked = valid(run(back, { kind: "idle", state: "locked", at: T0 + 18 * MIN }, T0 + 18 * MIN));
    const second = valid(run(locked, { kind: "tick" }, T0 + 28 * MIN));
    expect(second.notified.continuePrompt).toBeUndefined();
    const r = run(second, { kind: "idle", state: "active", at: T0 + 29 * MIN }, T0 + 29 * MIN);
    expect(notifications(r.effects)).toHaveLength(1);
  });
});

describe("other inputs", () => {
  it("tick in ACTIVE with nothing to do: no state write, only the tooltip refresh", () => {
    const st = started();
    const r = run(st, { kind: "tick" }, T0 + 30_000);
    expect(r.state).toBe(st);
    expect(types(r.effects)).toEqual(["SetBadge", "SetActionTitle"]);
    // lastSeenAt is refreshed once it is a minute old.
    expect(valid(run(st, { kind: "tick" }, T0 + MIN)).lastSeenAt).toBe(T0 + MIN);
  });
  it("tick / fb.* alarms with no session clear every alarm; tick outside ACTIVE clears fb.tick", () => {
    expect(alarmsCleared(run(null, { kind: "tick" }, T0).effects).sort()).toEqual([...ALL].sort());
    expect(alarmsCleared(run(null, { kind: "alarm", name: "fb.breakEnd" }, T0).effects)).toHaveLength(5);
    expect(run(paused(), { kind: "tick" }, T0 + 11 * MIN).effects).toEqual([{ type: "ClearAlarm", name: "fb.tick" }]);
  });
  it("unknown and foreign alarm names are ignored", () => {
    const st = started();
    expect(run(st, { kind: "alarm", name: "other" }, T0)).toEqual({ state: st, effects: [] });
    expect(run(st, { kind: "alarm", name: "fb.unknown" }, T0)).toEqual({ state: st, effects: [] });
  });
  it("ENDING ignores ticks, alarms and idle events", () => {
    const ending = valid(run(started(), cmd("session.stop"), T0 + MIN));
    for (const input of [
      { kind: "tick" as const },
      { kind: "alarm" as const, name: "fb.sessionEnd" },
      { kind: "idle" as const, state: "active" as const, at: T0 },
    ]) {
      expect(run(ending, input, T0 + 2 * MIN)).toEqual({ state: ending, effects: [] });
    }
  });
  it("a clock that goes backwards never moves session time backwards", () => {
    const st = valid(run(started(), cmd("session.pause"), T0 + 10 * MIN));
    const r = valid(run(st, cmd("session.resume"), T0 + 5 * MIN));
    expect(r.session.pauses[0]).toEqual({ from: T0 + 10 * MIN, to: T0 + 10 * MIN, kind: "pause" });
    expect(r.lastSeenAt).toBe(T0 + 10 * MIN);
  });
  it("unknown command type with a valid payload → internal (router never sends one)", () => {
    expect(run(started(), cmd("session.bogus"), T0).error).toBe("internal");
  });
});
