// Time helpers, snapshot builder, SessionRecord builder, presentation, payload
// parsers, and the DATA_MODEL v1.3 validator fields.
import { describe, expect, it } from "vitest";
import { parseEmpty, parseMinutes, parseNote, parseStartPayload } from "../../../src/core/session/draft";
import { alarmsFor, presentation } from "../../../src/core/session/present";
import { buildSnapshot, snapshotKey } from "../../../src/core/session/snapshot";
import { buildSessionRecord } from "../../../src/core/session/summary";
import { elapsedMs, endsAt, naturalEndAt, pausedMs, remainingMs, totalMs } from "../../../src/core/session/time";
import { validateActiveState, validateSessionRecord } from "../../../src/core/storage/validate";
import type { ActiveState } from "../../../src/core/types";
import { activeState } from "../storage/fixtures";
import { cmd, draft, MIN, run, started, T0, valid } from "./helpers";

describe("time", () => {
  const s = { ...started().session, pauses: [{ from: T0 + 10 * MIN, to: T0 + 20 * MIN, kind: "pause" as const }] };
  it("elapsed, total, remaining, endsAt (ACTIVE)", () => {
    expect(totalMs(s)).toBe(60 * MIN);
    expect(elapsedMs(s, T0 + 30 * MIN)).toBe(20 * MIN);
    expect(remainingMs(s, T0 + 30 * MIN)).toBe(40 * MIN);
    expect(endsAt(s, T0 + 30 * MIN)).toBe(T0 + 70 * MIN);
    expect(remainingMs(s, T0 + 999 * MIN)).toBe(0);
    expect(naturalEndAt(s, T0 + 80 * MIN)).toBe(T0 + 70 * MIN);
    expect(naturalEndAt(s, T0 + 50 * MIN)).toBe(T0 + 50 * MIN);
  });
  it("an open pause counts until now; PAUSED endsAt is frozen", () => {
    const p = {
      ...s,
      state: "PAUSED" as const,
      pauses: [...s.pauses, { from: T0 + 30 * MIN, kind: "pause" as const }],
    };
    expect(elapsedMs(p, T0 + 50 * MIN)).toBe(20 * MIN);
    expect(endsAt(p, T0 + 50 * MIN)).toBe(T0 + 70 * MIN);
    expect(endsAt(p, T0 + 500 * MIN)).toBe(T0 + 70 * MIN);
    expect(pausedMs(p, T0 + 50 * MIN, "pause")).toBe(30 * MIN);
    expect(pausedMs(p, T0 + 50 * MIN, "break")).toBe(0);
    expect(elapsedMs(p, T0 - MIN)).toBe(0);
  });
});

describe("buildSnapshot (API_CONTRACTS §6)", () => {
  it("no session / ENDING → session null, notices and lastSummaryId carried", () => {
    const notices = [{ code: "safe_mode" as const, at: 5 }];
    expect(buildSnapshot(null, notices, "abc", T0)).toEqual({
      v: 1,
      at: T0,
      session: null,
      notices,
      lastSummaryId: "abc",
    });
    const ending = valid(run(started(), cmd("session.stop"), T0 + MIN));
    expect(buildSnapshot(ending, [], undefined, T0).session).toBeNull();
  });
  it("ACTIVE: fields per §6, status on_task, no titles", () => {
    const snap = buildSnapshot(started(), [], undefined, T0 + MIN);
    expect(snap.session).toEqual({
      id: "s1",
      state: "ACTIVE",
      awaitingContinue: false,
      taskLabel: "Write report",
      objective: "Finish the draft",
      nextStep: "Outline section 2",
      plannedMin: 60,
      endsAt: T0 + 60 * MIN,
      mode: "gentle",
      attention: "ACTIVE_INPUT",
      status: "on_task",
    });
    expect(snap.lastSummaryId).toBeUndefined();
  });
  it("PAUSED has pausedAt; awaitingContinue has awaySince; ON_BREAK has breakEndsAt; mutedUntil carried", () => {
    const p = valid(run(started(), cmd("session.pause"), T0 + 5 * MIN));
    expect(buildSnapshot(p, [], undefined, T0 + 9 * MIN).session).toMatchObject({
      pausedAt: T0 + 5 * MIN,
      endsAt: T0 + 60 * MIN,
    });
    const locked = valid(run(started(), { kind: "idle", state: "locked", at: T0 + MIN }, T0 + MIN));
    const away = valid(run(locked, { kind: "tick" }, T0 + 11 * MIN));
    expect(buildSnapshot(away, [], undefined, T0 + 11 * MIN).session).toMatchObject({
      awaitingContinue: true,
      awaySince: T0 + MIN,
      attention: "LOCKED",
    });
    const b = valid(run(started(), cmd("break.start", { minutes: 5 }), T0 + MIN));
    expect(buildSnapshot(b, [], undefined, T0 + 2 * MIN).session).toMatchObject({ breakEndsAt: T0 + 6 * MIN });
    const muted: ActiveState = { ...started(), policy: { ...started().policy, mutedUntil: T0 + 9 } };
    expect(buildSnapshot(muted, [], undefined, T0).session?.mutedUntil).toBe(T0 + 9);
  });
  it("snapshotKey ignores `at`", () => {
    const a = buildSnapshot(started(), [], undefined, T0 + MIN);
    const b = buildSnapshot(started(), [], undefined, T0 + 2 * MIN);
    expect(snapshotKey(a)).toBe(snapshotKey(b));
  });
  it("is under 4 KB with maximal text", () => {
    const big = started(T0, { taskLabel: "x".repeat(120), objective: "y".repeat(300), nextStep: "z".repeat(500) });
    expect(JSON.stringify(buildSnapshot(big, [{ code: "safe_mode", at: 1 }], "a".repeat(64), T0)).length).toBeLessThan(
      4096,
    );
  });
});

describe("buildSessionRecord", () => {
  it("times from the session, aggregates zero, away and break from pauses; validates", () => {
    let st = started(T0, { plannedMin: 120 });
    st = valid(run(st, cmd("break.start", { minutes: 10 }), T0 + 10 * MIN));
    st = valid(run(st, cmd("break.end"), T0 + 20 * MIN));
    st = valid(run(st, { kind: "idle", state: "locked", at: T0 + 30 * MIN }, T0 + 30 * MIN));
    st = valid(run(st, { kind: "tick" }, T0 + 45 * MIN));
    st = valid(run(st, cmd("session.stop"), T0 + 50 * MIN));
    const rec = buildSessionRecord(st, "user_stop", T0 + 50 * MIN);
    expect(validateSessionRecord(rec).ok).toBe(true);
    expect(rec).toMatchObject({ id: "s1", startedAt: T0, endedAt: T0 + 50 * MIN, plannedMin: 120, actualMin: 20 });
    expect(rec.summary).toMatchObject({
      awayMin: 20,
      breakMin: 10,
      idleMin: 0,
      focusedMin: 0,
      interventions: 0,
      responses: {},
    });
    expect(buildSessionRecord(st, "user_stop", T0 - 5).endedAt).toBe(T0);
    // D-022: awayMin also includes the browser-closed time (awayMs).
    expect(buildSessionRecord({ ...st, awayMs: 7 * MIN + 20_000 }, "user_stop", T0 + 50 * MIN).summary.awayMin).toBe(
      27,
    );
  });
});

describe("presentation / alarmsFor", () => {
  it("ENDING or null → no badge, no alarms", () => {
    expect(presentation(null, T0, false)).toEqual([
      { type: "SetBadge", text: "" },
      { type: "SetActionTitle", key: "tooltip.none", vars: {} },
    ]);
    expect(alarmsFor(null, T0).every((e) => e.type === "ClearAlarm")).toBe(true);
  });
});

describe("payload parsers", () => {
  it("parseStartPayload / parseEmpty / parseMinutes / parseNote", () => {
    expect(parseStartPayload({ draft: draft() }, "gentle").ok).toBe(true);
    expect(parseStartPayload(null, "gentle").ok).toBe(false);
    expect(parseStartPayload({ draft: { ...draft(), plannedMin: "60" } }, "gentle").ok).toBe(false);
    expect(parseEmpty({})).toBe(true);
    expect(parseEmpty(undefined)).toBe(false);
    expect(parseEmpty({ a: 1 })).toBe(false);
    expect(parseMinutes({ minutes: 5 }, 5, 10)).toEqual({ ok: true, value: 5 });
    expect(parseMinutes(() => 1, 5, 10).ok).toBe(false);
    expect(parseNote({})).toEqual({ ok: true, value: {} });
    expect(parseNote(Symbol("x")).ok).toBe(false);
    expect(parseNote({ objective: 1 }).ok).toBe(false);
  });
});

describe("validateActiveState: DATA_MODEL v1.3 fields (attentionSince, awayMs, notified)", () => {
  const errs = (v: unknown) => {
    const r = validateActiveState(v);
    return r.ok ? [] : r.errors;
  };
  it("accepts every notified key, and an empty notified", () => {
    expect(errs(activeState({ notified: {} }))).toEqual([]);
    expect(errs(activeState({ notified: { start: 1, continuePrompt: 2, breakOver: 3, breakRepeat: 4 } }))).toEqual([]);
  });
  it("requires attentionSince and notified", () => {
    const noSince: Record<string, unknown> = { ...activeState() };
    delete noSince.attentionSince;
    const noNotified: Record<string, unknown> = { ...activeState() };
    delete noNotified.notified;
    expect(errs(noSince)).toContain("active.attentionSince:missing");
    expect(errs(noNotified)).toContain("active.notified:missing");
  });
  it("rejects unknown notified keys, bad times, attentionSince before start", () => {
    expect(errs(activeState({ notified: { title: 1 } as never }))).toContain("active.notified.title:unknown_key");
    expect(errs(activeState({ notified: { start: -1 } }))).toContain("active.notified.start:below_min");
    expect(errs(activeState({ notified: { start: Number.NaN } }))).toContain("active.notified.start:not_finite_number");
    expect(errs(activeState({ notified: [] as never }))).toContain("active.notified:not_object");
    expect(errs(activeState({ attentionSince: 999 }))).toContain("active.attentionSince:before_session_start");
    expect(errs(activeState({ attentionSince: "1" as never }))).toContain("active.attentionSince:not_finite_number");
    expect(errs(activeState({ awayMs: 12.5 }))).toEqual([]);
    expect(errs(activeState({ awayMs: -1 }))).toContain("active.awayMs:below_min");
    expect(errs(activeState({ awayMs: Number.POSITIVE_INFINITY }))).toContain("active.awayMs:not_finite_number");
    const noAway: Record<string, unknown> = { ...activeState() };
    delete noAway.awayMs;
    expect(errs(noAway)).toContain("active.awayMs:missing");
  });
});
