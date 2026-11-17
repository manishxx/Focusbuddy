// Property-style tests: random sequences of valid commands, alarms, idle changes,
// ticks and restarts with random time advances keep the §5.1.1 invariants.
// Seeded PRNG, so a failure is reproducible from the printed seed.
import { describe, expect, it } from "vitest";
import { reduceSession } from "../../../src/core/session/reducer";
import { buildSessionRecord } from "../../../src/core/session/summary";
import { elapsedMs, endsAt, openPause, pausedMs, remainingMs, totalMs } from "../../../src/core/session/time";
import type { Effect, SessionInput } from "../../../src/core/session/types";
import { validateActiveState } from "../../../src/core/storage/validate";
import type { ActiveState } from "../../../src/core/types";
import { cmd, draft, MIN, T0 } from "./helpers";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Alarm = { when?: number; periodMin?: number };

const seen = new Set<string>();

function simulate(seed: number, steps: number): void {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  let now = T0;
  let state: ActiveState | null = null;
  let ids = 0;
  const alarms = new Map<string, Alarm>();
  const shown = new Map<string, number>();
  // Browser-closed gaps added to awayMs, as intervals (review F4: never overlap a pause).
  let gaps: Array<{ from: number; to: number }> = [];
  const applyAlarms = (fx: Effect[]) => {
    for (const e of fx) {
      if (e.type === "ScheduleAlarm")
        alarms.set(e.name, {
          ...(e.when !== undefined && { when: e.when }),
          ...(e.periodMin !== undefined && { periodMin: e.periodMin }),
        });
      if (e.type === "ClearAlarm") alarms.delete(e.name);
    }
  };
  for (let i = 0; i < steps; i++) {
    now += Math.floor(rnd() * pick([0.2, 2, 15, 60, 300]) * MIN);
    let input: SessionInput;
    const r = rnd();
    if (state === null && r < 0.5)
      input = cmd("session.start", { draft: draft({ plannedMin: pick([5, 30, 60, 240, 480]) }) });
    else if (r < 0.55)
      input = { kind: "startup", startShown: rnd() < 0.5, shownNotificationIds: ["fb.start.old", "x"] };
    else if (r < 0.65) input = { kind: "tick" };
    else if (r < 0.75)
      input = { kind: "idle", state: pick(["active", "idle", "locked"] as const), at: now - Math.floor(rnd() * MIN) };
    else if (r < 0.85 && alarms.size > 0) {
      const due = [...alarms.entries()].filter(([, a]) => a.when === undefined || a.when <= now);
      input = { kind: "alarm", name: due.length > 0 ? pick(due)[0] : pick([...alarms.keys()]) };
    } else {
      input = pick([
        cmd("session.pause"),
        cmd("session.resume"),
        cmd("session.continue"),
        cmd("session.stop"),
        cmd("session.extend", { minutes: pick([5, 15, 120]) }),
        cmd("session.updateNote", { nextStep: "next" }),
        cmd("break.start", { minutes: pick([1, 10, 60]) }),
        cmd("break.end"),
        cmd("break.extend", { minutes: pick([1, 5, 15]) }),
      ]);
    }
    const before = state;
    const privateNotifications = rnd() < 0.3;
    const res = reduceSession(state, input, {
      now,
      privateNotifications,
      defaultMode: "gentle",
      newId: () => `id${++ids}`,
    });
    const where = `seed ${seed} step ${i} ${JSON.stringify(input)}`;
    if (res.error !== undefined) {
      expect(res.state, where).toBe(before);
      expect(res.effects, where).toEqual([]);
      continue;
    }
    state = res.state;
    applyAlarms(res.effects);
    // Review F10: generic (private) text never carries the task, objective or next step.
    for (const e of res.effects) {
      if (e.type !== "ShowNotification" && e.type !== "SetActionTitle") continue;
      if (e.type === "ShowNotification") expect(e.generic, where).toBe(privateNotifications);
      if (!privateNotifications) continue;
      expect(
        Object.keys(e.vars).filter((k) => ["task", "objective", "nextStep"].includes(k)),
        where,
      ).toEqual([]);
      const text = JSON.stringify(e.vars);
      for (const t of ["Write report", "Finish the draft", "Outline section 2"]) expect(text, where).not.toContain(t);
    }
    if (before !== null && state !== null && state.session.id === before.session.id && state.awayMs > before.awayMs) {
      gaps.push({ from: before.lastSeenAt, to: before.lastSeenAt + (state.awayMs - before.awayMs) });
    }
    if (state === null || before === null || state.session.id !== before.session.id) {
      if (state === null || before?.session.id !== state.session.id) gaps = [];
    }
    for (const e of res.effects) {
      if (e.type === "ShowNotification") {
        // At most once per occurrence: never re-shown while its notified.* time is set.
        const key = `${e.id}:${e.titleKey}`;
        // fb.start: once, plus at most one AC-32 repeat at a Startup within 60 s.
        const count = (shown.get(key) ?? 0) + 1;
        if (e.id.startsWith("fb.start.")) {
          expect(count, where).toBeLessThanOrEqual(2);
          if (count === 2) expect(input.kind, where).toBe("startup");
        }
        shown.set(key, count);
      }
    }
    if (state === null) {
      expect(
        [...alarms.keys()].filter((n) => n === "fb.tick"),
        where,
      ).toEqual([]);
      continue;
    }
    // Invariants.
    const v = validateActiveState(state);
    expect(v.ok ? [] : v.errors, where).toEqual([]);
    const s = state.session;
    seen.add(s.state);
    if (s.awaitingContinue === true) seen.add("awaitingContinue");
    if (state.awayMs > 0) seen.add("awayMs");
    if (s.ending !== undefined) seen.add(`end:${s.ending.endReason}`);
    for (const e of res.effects) if (e.type === "ShowNotification") seen.add(`notify:${e.titleKey}`);
    expect(s.pauses.filter((p) => p.to === undefined).length, where).toBeLessThanOrEqual(1);
    const left = remainingMs(s, now);
    expect(left, where).toBeGreaterThanOrEqual(0);
    expect(left, where).toBeLessThanOrEqual(totalMs(s));
    if (s.state === "ACTIVE") {
      expect(openPause(s), where).toBeUndefined();
      expect(endsAt(s, now), where).toBe(now + left);
      expect(alarms.has("fb.tick"), where).toBe(true);
      expect(alarms.get("fb.sessionEnd")?.when, where).toBe(endsAt(s, now));
    } else {
      expect(alarms.has("fb.tick"), where).toBe(false);
    }
    if (s.state === "PAUSED") {
      expect(openPause(s), where).toBeDefined();
      expect(endsAt(s, now + 7 * MIN), where).toBe(endsAt(s, now)); // frozen
      expect(alarms.has("fb.stalePause"), where).toBe(true);
    }
    if (s.state === "ON_BREAK") {
      expect(openPause(s)?.kind, where).toBe("break");
      expect(s.breakEndsAt, where).toBeDefined();
    }
    // Review F4: pauses and counted gaps never overlap, and time adds up to the wall clock.
    const until = s.ending?.endedAt ?? now;
    const intervals = [...s.pauses.map((p) => ({ from: p.from, to: p.to ?? Math.max(p.from, until) })), ...gaps].sort(
      (x, y) => x.from - y.from,
    );
    for (let k = 1; k < intervals.length; k++) {
      const prev = intervals[k - 1];
      const cur = intervals[k];
      if (prev && cur)
        expect(cur.from, `${where} overlap ${JSON.stringify(intervals)}`).toBeGreaterThanOrEqual(prev.to);
    }
    const wall = until - s.startedAt;
    expect(pausedMs(s, until) + elapsedMs(s, until), where).toBeLessThanOrEqual(wall);
    expect(state.awayMs, where).toBeLessThanOrEqual(elapsedMs(s, until) + 1);
    if (s.state === "ENDING" && s.ending !== undefined) {
      // In minutes: session time (actualMin, which already contains awayMs: away counts as
      // session time per D-022) + absence pauses + break + user pauses ≤ wall clock + 1
      // (+1 more for the four independent roundings).
      const rec = buildSessionRecord(state, s.ending.endReason, s.ending.endedAt);
      const userPauseMin = Math.round(pausedMs(s, until, "pause") / MIN);
      const absentPauseMin = Math.round(pausedMs(s, until, "auto_absent") / MIN);
      expect(rec.actualMin + absentPauseMin + rec.summary.breakMin + userPauseMin, where).toBeLessThanOrEqual(
        Math.round(wall / MIN) + 2,
      );
      expect(rec.summary.awayMin, where).toBeLessThanOrEqual(rec.actualMin + absentPauseMin + 1);
    }
    if (s.state === "ENDING") {
      expect(
        res.effects.some((e) => e.type === "BuildSummaryAndPurgeRaw"),
        where,
      ).toBe(true);
      expect(alarms.size, where).toBe(0);
      // The engine's summary effect removes session.active.
      state = null;
    }
  }
}

describe("random sequences keep the invariants", () => {
  it.each(Array.from({ length: 60 }, (_, i) => i + 1))("seed %i", (seed) => {
    simulate(seed, 250);
  });
  it("the sequences reach every state, end reason and notification", () => {
    for (const k of [
      "ACTIVE",
      "PAUSED",
      "ON_BREAK",
      "ENDING",
      "awaitingContinue",
      "awayMs",
      "end:time_up",
      "end:user_stop",
      "end:stale_pause",
      "end:expired_while_closed",
      "notify:start.title",
      "notify:continue.title",
      "notify:break.over.title",
    ]) {
      expect(seen.has(k), k).toBe(true);
    }
  });
});
