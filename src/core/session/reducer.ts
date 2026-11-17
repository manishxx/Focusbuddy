/**
 * Session state machine (ARCHITECTURE §5.1, §5.1.1 transition table). Pure:
 * `reduceSession(state, input, ctx) → {state, effects, error?}`. It never reads a
 * clock (ctx.now), never throws for bad input, and returns the state unchanged with
 * an error code for an invalid transition.
 *
 * Notifications are at-most-once: each one records its attempt time in
 * `notified.*` (DATA_MODEL v1.3) and is never emitted while that time is set, so a
 * restart between persist and effects can't show it twice (NFR-3, AC-02). The
 * break and continue entries are per occurrence: a new break, a break extension
 * (BR-3 reset) or a new absence auto-pause clears them.
 */
import type { ActiveSession, ActiveState, EndReason, Notified } from "../types";
import { parseEmpty, parseMinutes, parseNote, parseStartPayload } from "./draft";
import { alarmsFor, clearAllAlarms, notificationIds, presentation } from "./present";
import {
  AWAY_AUTO_PAUSE_MS,
  AWAY_GAP_MS,
  BREAK_PROMPT_DELAY_MS,
  endsAt,
  IDLE_AUTO_PAUSE_MS,
  LAST_SEEN_REFRESH_MS,
  LOCKED_AUTO_PAUSE_MS,
  MAX_TOTAL_MIN,
  MINUTE_MS,
  naturalEndAt,
  openPause,
  remainingMs,
  STALE_PAUSE_MS,
  TICK_PERIOD_MIN,
} from "./time";
import type { Effect, ErrorCode, ReduceContext, ReduceResult, SessionCommand, SessionInput } from "./types";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** An fb.sessionEnd alarm that fires this close to the end counts as "time up" (alarm rounding). */
export const ALARM_SLACK_MS = 1_000;

type Ctx = ReduceContext & { at: number };

const ok = (state: ActiveState | null, effects: Effect[], data?: Record<string, unknown>): ReduceResult => ({
  state,
  effects,
  ...(data !== undefined && { data }),
});

const fail = (state: ActiveState | null, error: ErrorCode, data?: Record<string, unknown>): ReduceResult => ({
  state,
  effects: [],
  error,
  ...(data !== undefined && { data }),
});

function withSession(st: ActiveState, patch: Partial<ActiveSession>, at: number): ActiveState {
  return { ...st, session: { ...st.session, ...patch }, lastSeenAt: at };
}

function omitSession(s: ActiveSession, ...keys: ("breakEndsAt" | "awaitingContinue" | "awaySince")[]): ActiveSession {
  const out = { ...s };
  for (const k of keys) delete out[k];
  return out;
}

function omitNotified(n: Notified, ...keys: (keyof Notified)[]): Notified {
  const out = { ...n };
  for (const k of keys) delete out[k];
  return out;
}

const onTask = (at: number): ActiveState["drift"] => ({ phase: "ON_TASK", since: at, accumulatedMs: 0 });

function closeOpen(pauses: ActiveSession["pauses"], to: number): ActiveSession["pauses"] {
  return pauses.map((p) => (p.to === undefined ? { ...p, to: Math.max(p.from, to) } : p));
}

/** Badge, title and snapshot for the new state. */
function show(st: ActiveState | null, ctx: Ctx): Effect[] {
  return [...presentation(st, ctx.at, ctx.privateNotifications), { type: "PublishSnapshot" }];
}

// ---- ENDING (§5.1.1 last row) ----

function endingEffects(st: ActiveState): Effect[] {
  const s = st.session;
  const ending = s.ending ?? { endReason: "user_stop", endedAt: st.lastSeenAt };
  const ids = notificationIds(s.id);
  return [
    { type: "BuildSummaryAndPurgeRaw", sessionId: s.id, endReason: ending.endReason, endedAt: ending.endedAt },
    ...clearAllAlarms(),
    { type: "ClearNotification", id: ids.start },
    { type: "ClearNotification", id: ids.continue },
    { type: "ClearNotification", id: ids.break },
    ...presentation(null, st.lastSeenAt, false),
    { type: "PublishSnapshot" },
  ];
}

/** Persists ENDING first (the engine writes state before effects), then summary + cleanup. */
function toEnding(st: ActiveState, reason: EndReason, endedAt: number, ctx: Ctx): ReduceResult {
  const s = st.session;
  const at = Math.max(endedAt, s.startedAt);
  const session: ActiveSession = {
    ...s,
    state: "ENDING",
    pauses: closeOpen(s.pauses, at),
    ending: { endReason: reason, endedAt: at },
  };
  const next: ActiveState = { ...st, session, lastSeenAt: ctx.at };
  return ok(next, endingEffects(next));
}

/** "Any input with remainingMs = 0" (ACTIVE) and "any input with an open pause > 4 h" (PAUSED, ON_BREAK). */
function autoEnd(st: ActiveState, ctx: Ctx, expiredReason: EndReason = "time_up"): ReduceResult | null {
  const s = st.session;
  if (s.state === "ACTIVE" && remainingMs(s, ctx.at) === 0) {
    return toEnding(st, expiredReason, naturalEndAt(s, ctx.at), ctx);
  }
  if (s.state === "PAUSED" || s.state === "ON_BREAK") {
    // D-022: a break open for more than 4 h is stale too.
    const open = openPause(s);
    if (open !== undefined && ctx.at - open.from >= STALE_PAUSE_MS) return toEnding(st, "stale_pause", ctx.at, ctx);
  }
  return null;
}

// ---- shared transitions ----

/** PAUSED/ON_BREAK → ACTIVE on a user command: closes the pause and re-arms the ACTIVE alarms. */
function backToActive(st: ActiveState, ctx: Ctx, extra: Effect[]): ActiveState {
  const s = omitSession(st.session, "breakEndsAt", "awaitingContinue", "awaySince");
  // A user command means the user is here: attention restarts as ACTIVE_INPUT, so a stale
  // IDLE/LOCKED from before the pause can't auto-pause again at the next tick.
  const next: ActiveState = {
    ...st,
    session: { ...s, state: "ACTIVE", pauses: closeOpen(s.pauses, ctx.at) },
    lastSeenAt: ctx.at,
    attention: "ACTIVE_INPUT",
    attentionSince: ctx.at,
    drift: onTask(ctx.at),
  };
  extra.push(
    { type: "ScheduleAlarm", name: "fb.sessionEnd", when: endsAt(next.session, ctx.at) },
    { type: "ScheduleAlarm", name: "fb.tick", periodMin: TICK_PERIOD_MIN },
    { type: "ClearAlarm", name: "fb.stalePause" },
    { type: "ClearAlarm", name: "fb.breakEnd" },
    { type: "ClearAlarm", name: "fb.breakPrompt" },
  );
  return next;
}

/** ACTIVE → PAUSED (manual pause or absence auto-pause). */
function toPaused(st: ActiveState, ctx: Ctx, from: number, kind: "pause" | "auto_absent"): ReduceResult {
  const s = st.session;
  const session: ActiveSession = {
    ...s,
    state: "PAUSED",
    pauses: [...s.pauses, { from, kind }],
    ...(kind === "auto_absent" && { awaitingContinue: true, awaySince: from }),
  };
  const next: ActiveState = {
    ...st,
    session,
    lastSeenAt: ctx.at,
    drift: onTask(ctx.at),
    notified: kind === "auto_absent" ? omitNotified(st.notified, "continuePrompt") : st.notified,
  };
  return ok(next, [
    { type: "ClearAlarm", name: "fb.tick" },
    { type: "ClearAlarm", name: "fb.sessionEnd" },
    { type: "ScheduleAlarm", name: "fb.stalePause", when: from + STALE_PAUSE_MS },
    ...show(next, ctx),
  ]);
}

/** LOCKED ≥ 10 min or IDLE ≥ 30 min (from attentionSince) → auto-pause, then the stale check. */
function maybeAutoPause(st: ActiveState, ctx: Ctx): ReduceResult | null {
  if (st.session.state !== "ACTIVE") return null;
  const away = ctx.at - st.attentionSince;
  const hit =
    (st.attention === "LOCKED" && away >= LOCKED_AUTO_PAUSE_MS) ||
    (st.attention === "IDLE" && away >= IDLE_AUTO_PAUSE_MS);
  if (!hit) return null;
  // Never overlap an earlier pause (that would count the same time twice).
  const lastEnd = st.session.pauses.reduce((m, p) => Math.max(m, p.to ?? p.from), st.session.startedAt);
  const from = Math.min(ctx.at, Math.max(st.attentionSince, lastEnd));
  const paused = toPaused(st, ctx, from, "auto_absent");
  if (paused.state === null) return paused;
  const stale = autoEnd(paused.state, ctx);
  return stale ?? paused;
}

function breakNotification(st: ActiveState, ctx: Ctx): Effect {
  const generic = ctx.privateNotifications;
  return {
    type: "ShowNotification",
    id: notificationIds(st.session.id).break,
    titleKey: "break.over.title",
    bodyKey: generic ? "break.over.body.generic" : "break.over.body",
    vars: generic ? {} : { task: st.session.taskLabel },
    generic,
  };
}

// ---- commands ----

function start(st: ActiveState | null, payload: unknown, ctx: Ctx): ReduceResult {
  if (st !== null) return fail(st, "invalid_state", { activeSessionId: st.session.id });
  const parsed = parseStartPayload(payload, ctx.defaultMode);
  if (!parsed.ok) return fail(null, "invalid_message");
  const id = ctx.newId();
  if (!ID.test(id)) return fail(null, "internal");
  const { config, plannedMin } = parsed.value;
  const at = ctx.at;
  const generic = ctx.privateNotifications;
  const next: ActiveState = {
    schemaVersion: 1,
    session: { ...config, id, state: "ACTIVE", startedAt: at, plannedMin, extensionsMin: 0, pauses: [] },
    lastSeenAt: at,
    attention: "ACTIVE_INPUT",
    attentionSince: at,
    awayMs: 0,
    notified: { start: at },
    drift: onTask(at),
    policy: { level: 0, deliveredAt: [], sessionCount: 0, repeatsByEpisode: {} },
    sessionOverrides: [],
    segSeq: 0,
  };
  return ok(
    next,
    [
      { type: "ScheduleAlarm", name: "fb.sessionEnd", when: endsAt(next.session, at) },
      { type: "ScheduleAlarm", name: "fb.tick", periodMin: TICK_PERIOD_MIN },
      {
        type: "ShowNotification",
        id: notificationIds(id).start,
        titleKey: "start.title",
        bodyKey: generic ? "start.body.generic" : "start.body",
        vars: generic ? {} : { task: config.taskLabel, planned: { kind: "duration", ms: plannedMin * MINUTE_MS } },
        generic,
      },
      ...show(next, ctx),
    ],
    { sessionId: id },
  );
}

function command(st: ActiveState | null, cmd: SessionCommand, ctx: Ctx): ReduceResult {
  if (cmd.type === "session.start") return start(st, cmd.payload, ctx);
  const p = cmd.payload;
  // Payload shape first: a malformed message changes nothing (API_CONTRACTS §1).
  switch (cmd.type) {
    case "session.extend": {
      const m = parseMinutes(p, 5, 120);
      if (!m.ok) return fail(st, "invalid_message");
      return extend(st, m.value, ctx);
    }
    case "break.start": {
      const m = parseMinutes(p, 1, 60);
      if (!m.ok) return fail(st, "invalid_message");
      return breakStart(st, m.value, ctx);
    }
    case "break.extend": {
      const m = parseMinutes(p, 1, 15);
      if (!m.ok) return fail(st, "invalid_message");
      return breakExtend(st, m.value, ctx);
    }
    case "session.updateNote": {
      const n = parseNote(p);
      if (!n.ok) return fail(st, "invalid_message");
      if (st === null || st.session.state === "ENDING") return fail(st, "invalid_state");
      const auto = autoEnd(st, ctx);
      if (auto !== null) return auto;
      return ok(withSession(st, n.value, ctx.at), [{ type: "PublishSnapshot" }]);
    }
    default:
      if (!parseEmpty(p)) return fail(st, "invalid_message");
  }
  // Idempotent stop: nothing to stop is success (API_CONTRACTS §1 "idempotent where possible").
  if (st === null) return cmd.type === "session.stop" ? ok(null, []) : fail(null, "invalid_state");
  if (st.session.state === "ENDING") return fail(st, "invalid_state");
  const auto = autoEnd(st, ctx);
  if (auto !== null) return auto;
  const s = st.session;
  switch (cmd.type) {
    case "session.stop":
      return toEnding(st, "user_stop", ctx.at, ctx);
    case "session.pause":
      if (s.state === "PAUSED") return ok(st, []);
      if (s.state !== "ACTIVE") return fail(st, "invalid_state");
      return toPaused(st, ctx, ctx.at, "pause");
    case "session.resume": {
      if (s.state === "ACTIVE") return ok(st, []);
      if (s.state !== "PAUSED" || s.awaitingContinue === true) return fail(st, "invalid_state");
      const fx: Effect[] = [];
      const next = backToActive(st, ctx, fx);
      return ok(next, [...fx, ...show(next, ctx)]);
    }
    case "session.continue": {
      if (s.state === "ACTIVE") return ok(st, []);
      if (s.state !== "PAUSED" || s.awaitingContinue !== true) return fail(st, "invalid_state");
      const fx: Effect[] = [];
      const next = backToActive(st, ctx, fx);
      fx.push({ type: "ClearNotification", id: notificationIds(s.id).continue });
      return ok(next, [...fx, ...show(next, ctx)]);
    }
    case "break.end": {
      if (s.state === "ACTIVE") return ok(st, []);
      if (s.state !== "ON_BREAK") return fail(st, "invalid_state");
      const fx: Effect[] = [];
      const next = backToActive(st, ctx, fx);
      fx.push({ type: "ClearNotification", id: notificationIds(s.id).break });
      return ok(next, [...fx, ...show(next, ctx)]);
    }
    default:
      return fail(st, "internal");
  }
}

function extend(st: ActiveState | null, minutes: number, ctx: Ctx): ReduceResult {
  if (st === null || st.session.state === "ENDING") return fail(st, "invalid_state");
  const auto = autoEnd(st, ctx);
  if (auto !== null) return auto;
  const s = st.session;
  // D-022: over the 480-min cap → clamp and reply {cappedAt}.
  const room = Math.max(0, MAX_TOTAL_MIN - s.plannedMin - s.extensionsMin);
  const added = Math.min(minutes, room);
  if (added === 0) return ok(st, [], { cappedAt: endsAt(s, ctx.at) });
  const next = withSession(st, { extensionsMin: s.extensionsMin + added }, ctx.at);
  const fx: Effect[] = [];
  if (s.state === "ACTIVE")
    fx.push({ type: "ScheduleAlarm", name: "fb.sessionEnd", when: endsAt(next.session, ctx.at) });
  const data = added < minutes ? { cappedAt: endsAt(next.session, ctx.at) } : undefined;
  return ok(next, [...fx, ...show(next, ctx)], data);
}

function breakStart(st: ActiveState | null, minutes: number, ctx: Ctx): ReduceResult {
  if (st === null || st.session.state === "ENDING") return fail(st, "invalid_state");
  const auto = autoEnd(st, ctx);
  if (auto !== null) return auto;
  const s = st.session;
  if (s.state !== "ACTIVE") return fail(st, "invalid_state");
  // BR-2: the break can't outlast the session (its clock is stopped during the break).
  const breakEndsAt = Math.min(ctx.at + minutes * MINUTE_MS, ctx.at + remainingMs(s, ctx.at));
  const next: ActiveState = {
    ...st,
    session: { ...s, state: "ON_BREAK", pauses: [...s.pauses, { from: ctx.at, kind: "break" }], breakEndsAt },
    lastSeenAt: ctx.at,
    drift: onTask(ctx.at),
    notified: omitNotified(st.notified, "breakOver", "breakRepeat"),
  };
  return ok(next, [
    { type: "ScheduleAlarm", name: "fb.breakEnd", when: breakEndsAt },
    { type: "ScheduleAlarm", name: "fb.stalePause", when: ctx.at + STALE_PAUSE_MS },
    { type: "ClearAlarm", name: "fb.tick" },
    { type: "ClearAlarm", name: "fb.sessionEnd" },
    { type: "ClearAlarm", name: "fb.breakPrompt" },
    ...show(next, ctx),
  ]);
}

function breakExtend(st: ActiveState | null, minutes: number, ctx: Ctx): ReduceResult {
  if (st === null || st.session.state !== "ON_BREAK") return fail(st, "invalid_state");
  const auto = autoEnd(st, ctx);
  if (auto !== null) return auto;
  const s = st.session;
  // From the later of the old end and now, so "5 more minutes" after the prompt means 5 from now.
  const base = Math.max(s.breakEndsAt ?? ctx.at, ctx.at);
  const breakEndsAt = Math.min(base + minutes * MINUTE_MS, ctx.at + remainingMs(s, ctx.at));
  const next: ActiveState = {
    ...withSession(st, { breakEndsAt }, ctx.at),
    notified: omitNotified(st.notified, "breakOver", "breakRepeat"),
  };
  return ok(next, [
    { type: "ScheduleAlarm", name: "fb.breakEnd", when: breakEndsAt },
    { type: "ScheduleAlarm", name: "fb.stalePause", when: (openPause(s)?.from ?? ctx.at) + STALE_PAUSE_MS },
    { type: "ClearAlarm", name: "fb.breakPrompt" },
    { type: "ClearNotification", id: notificationIds(s.id).break },
    ...show(next, ctx),
  ]);
}

// ---- alarms, idle, tick ----

function alarm(st: ActiveState | null, name: string, ctx: Ctx): ReduceResult {
  if (!name.startsWith("fb.")) return ok(st, []);
  if (name === "fb.tick") return tick(st, ctx);
  if (st === null) return ok(null, clearAllAlarms());
  if (st.session.state === "ENDING") return ok(st, []);
  const s = st.session;
  const auto = autoEnd(st, ctx);
  if (auto !== null) return auto;
  switch (name) {
    case "fb.sessionEnd": {
      if (s.state !== "ACTIVE") return ok(st, [{ type: "ClearAlarm", name: "fb.sessionEnd" }]);
      const left = remainingMs(s, ctx.at);
      if (left <= ALARM_SLACK_MS) return toEnding(st, "time_up", naturalEndAt(s, ctx.at), ctx);
      // Fired early or stale (e.g. after an extend): re-arm.
      return ok(st, [{ type: "ScheduleAlarm", name: "fb.sessionEnd", when: endsAt(s, ctx.at) }]);
    }
    case "fb.stalePause": {
      if (s.state !== "PAUSED" && s.state !== "ON_BREAK")
        return ok(st, [{ type: "ClearAlarm", name: "fb.stalePause" }]);
      const open = openPause(s);
      return ok(st, [{ type: "ScheduleAlarm", name: "fb.stalePause", when: (open?.from ?? ctx.at) + STALE_PAUSE_MS }]);
    }
    case "fb.breakEnd": {
      if (s.state !== "ON_BREAK") return ok(st, [{ type: "ClearAlarm", name: "fb.breakEnd" }]);
      if (st.notified.breakOver !== undefined) return ok(st, []);
      const next: ActiveState = { ...st, lastSeenAt: ctx.at, notified: { ...st.notified, breakOver: ctx.at } };
      return ok(next, [
        breakNotification(st, ctx),
        { type: "ScheduleAlarm", name: "fb.breakPrompt", when: ctx.at + BREAK_PROMPT_DELAY_MS },
        { type: "PublishSnapshot" },
      ]);
    }
    case "fb.breakPrompt": {
      if (s.state !== "ON_BREAK") return ok(st, [{ type: "ClearAlarm", name: "fb.breakPrompt" }]);
      if (st.notified.breakOver === undefined || st.notified.breakRepeat !== undefined) return ok(st, []);
      const next: ActiveState = { ...st, lastSeenAt: ctx.at, notified: { ...st.notified, breakRepeat: ctx.at } };
      return ok(next, [breakNotification(st, ctx)]);
    }
    default:
      return ok(st, []);
  }
}

function tick(st: ActiveState | null, ctx: Ctx): ReduceResult {
  if (st === null) return ok(null, clearAllAlarms());
  if (st.session.state === "ENDING") return ok(st, []);
  const auto = autoEnd(st, ctx) ?? maybeAutoPause(st, ctx);
  if (auto !== null) return auto;
  if (st.session.state !== "ACTIVE") return ok(st, [{ type: "ClearAlarm", name: "fb.tick" }]);
  // Nothing changed: no write, except a periodic lastSeenAt refresh (reconciliation needs it).
  const next = ctx.at - st.lastSeenAt >= LAST_SEEN_REFRESH_MS ? { ...st, lastSeenAt: ctx.at } : st;
  return ok(next, presentation(next, ctx.at, ctx.privateNotifications));
}

const ATTENTION = { active: "ACTIVE_INPUT", idle: "IDLE", locked: "LOCKED" } as const;

function idle(st: ActiveState | null, input: { state: string; at: number }, ctx: Ctx): ReduceResult {
  if (st === null || st.session.state === "ENDING") return ok(st, []);
  const mapped =
    input.state === "active" || input.state === "idle" || input.state === "locked" ? ATTENTION[input.state] : null;
  if (mapped === null) return ok(st, []);
  const auto0 = autoEnd(st, ctx);
  if (auto0 !== null) return auto0;
  const s = st.session;
  const at = Number.isFinite(input.at) ? Math.min(ctx.at, Math.max(input.at, s.startedAt, st.attentionSince)) : ctx.at;
  if (s.state === "PAUSED" && s.awaitingContinue === true && mapped === "ACTIVE_INPUT") {
    const back: ActiveState = { ...st, attention: mapped, attentionSince: at, lastSeenAt: ctx.at };
    if (st.notified.continuePrompt !== undefined) return ok(back, [{ type: "PublishSnapshot" }]);
    const next: ActiveState = { ...back, notified: { ...st.notified, continuePrompt: ctx.at } };
    return ok(next, [
      {
        type: "ShowNotification",
        id: notificationIds(s.id).continue,
        titleKey: "continue.title",
        bodyKey: "continue.body",
        vars: {},
        generic: ctx.privateNotifications,
      },
      { type: "PublishSnapshot" },
    ]);
  }
  if (s.state !== "ACTIVE") return ok(st, []);
  const next: ActiveState =
    mapped === st.attention ? st : { ...st, attention: mapped, attentionSince: at, lastSeenAt: ctx.at };
  return maybeAutoPause(next, ctx) ?? ok(next, next === st ? [] : [{ type: "PublishSnapshot" }]);
}

// ---- reconciliation (§4, §5.1.1 "Reconciliation (Day 07 scope)") ----

function startup(st: ActiveState | null, corrupt: boolean, ctx: Ctx): ReduceResult {
  if (corrupt) {
    // DATA_MODEL §8: an invalid session.active is ended as stale_pause with no summary.
    // There is no readable session, so there is nothing to summarise; the engine removes it.
    return ok(null, [{ type: "Diag", code: "E_ACTIVE_CORRUPT_ENDED" }, ...clearAllAlarms(), ...show(null, ctx)]);
  }
  if (st === null) return ok(null, [...clearAllAlarms(), ...show(null, ctx)]);
  if (st.session.state === "ENDING") return ok(st, endingEffects(st));
  const s = st.session;
  const gap = ctx.at - st.lastSeenAt;
  const away = s.state === "ACTIVE" && gap > AWAY_GAP_MS;
  // D-022: the browser-closed gap counts as session time (BR-1) and goes into awayMs.
  // Expiry is checked with the gap included; only the part before the end is away time.
  const auto = autoEnd(st, ctx, "expired_while_closed");
  if (auto !== null) {
    if (!away || auto.state === null || auto.state.session.ending === undefined) return auto;
    const inSession = Math.max(0, auto.state.session.ending.endedAt - st.lastSeenAt);
    return { ...auto, state: { ...auto.state, awayMs: st.awayMs + inSession } };
  }
  if (!away) return ok(st, [...alarmsFor(st, ctx.at), ...show(st, ctx)]);
  const withAway: ActiveState = { ...st, awayMs: st.awayMs + gap, lastSeenAt: ctx.at };
  if (gap < AWAY_AUTO_PAUSE_MS) return ok(withAway, [...alarmsFor(withAway, ctx.at), ...show(withAway, ctx)]);
  // ≥ 10 min: auto-pause at now (D-016 anti-covert rule); the user is back, so the
  // continue prompt is shown once right away.
  const next: ActiveState = {
    ...withAway,
    session: {
      ...s,
      state: "PAUSED",
      pauses: [...s.pauses, { from: ctx.at, kind: "auto_absent" }],
      awaitingContinue: true,
      awaySince: st.lastSeenAt,
    },
    attention: "ACTIVE_INPUT",
    attentionSince: ctx.at,
    drift: onTask(ctx.at),
    notified: { ...st.notified, continuePrompt: ctx.at },
  };
  return ok(next, [
    ...alarmsFor(next, ctx.at),
    {
      type: "ShowNotification",
      id: notificationIds(s.id).continue,
      titleKey: "continue.title",
      bodyKey: "continue.body",
      vars: {},
      generic: ctx.privateNotifications,
    },
    ...show(next, ctx),
  ]);
}

export function reduceSession(state: ActiveState | null, input: SessionInput, context: ReduceContext): ReduceResult {
  // A clock that went backwards never moves session time backwards.
  const at = state === null ? context.now : Math.max(context.now, state.lastSeenAt);
  const ctx: Ctx = { ...context, at };
  switch (input.kind) {
    case "command":
      return command(state, input.command, ctx);
    case "alarm":
      return alarm(state, input.name, ctx);
    case "idle":
      return idle(state, input, ctx);
    case "tick":
      return tick(state, ctx);
    case "startup":
      return startup(state, input.corrupt === true, ctx);
  }
}
