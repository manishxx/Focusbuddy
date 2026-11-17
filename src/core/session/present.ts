/**
 * Toolbar badge and tooltip for a session state (UX_GUIDELINES §2.1), and the
 * alarms a state needs (ARCHITECTURE §7). Pure: returns effects.
 */
import type { ActiveState } from "../types";
import type { AlarmName, Effect } from "./types";
import { BREAK_PROMPT_DELAY_MS, endsAt, openPause, remainingMs, STALE_PAUSE_MS, TICK_PERIOD_MIN } from "./time";

/** UX_GUIDELINES §2.1 fixed badge fills (meaning is carried by the text). */
export const BADGE_COLORS = { on: "#0b6e69", checkin: "#8a5a00", slate: "#4a5560" } as const;

export const ALARM_NAMES: readonly AlarmName[] = [
  "fb.tick",
  "fb.sessionEnd",
  "fb.breakEnd",
  "fb.breakPrompt",
  "fb.stalePause",
];

export const notificationIds = (sessionId: string): { start: string; continue: string; break: string } => ({
  start: `fb.start.${sessionId}`,
  continue: `fb.continue.${sessionId}`,
  break: `fb.break.${sessionId}`,
});

/** Badge + tooltip for `state` at `now` (null = no session). */
export function presentation(state: ActiveState | null, now: number, generic: boolean): Effect[] {
  if (state === null || state.session.state === "ENDING") {
    return [
      { type: "SetBadge", text: "" },
      { type: "SetActionTitle", key: "tooltip.none", vars: {} },
    ];
  }
  const s = state.session;
  const task = s.taskLabel;
  switch (s.state) {
    case "ACTIVE":
      return [
        { type: "SetBadge", text: "ON", color: BADGE_COLORS.on },
        generic
          ? {
              type: "SetActionTitle",
              key: "tooltip.active.generic",
              vars: { timeLeft: { kind: "duration", ms: remainingMs(s, now) } },
            }
          : {
              type: "SetActionTitle",
              key: "tooltip.active",
              vars: { task, timeLeft: { kind: "duration", ms: remainingMs(s, now) } },
            },
      ];
    case "PAUSED":
      return [
        { type: "SetBadge", text: "II", color: BADGE_COLORS.slate },
        s.awaitingContinue === true
          ? { type: "SetActionTitle", key: "tooltip.awaitingContinue", vars: {} }
          : generic
            ? { type: "SetActionTitle", key: "tooltip.paused.generic", vars: {} }
            : { type: "SetActionTitle", key: "tooltip.paused", vars: { task } },
      ];
    default:
      // ON_BREAK
      return [
        { type: "SetBadge", text: "BRK", color: BADGE_COLORS.slate },
        { type: "SetActionTitle", key: "tooltip.break", vars: { time: { kind: "clock", at: s.breakEndsAt ?? now } } },
      ];
  }
}

/** Clears every fb.* alarm. */
export function clearAllAlarms(): Effect[] {
  return ALARM_NAMES.map((name) => ({ type: "ClearAlarm", name }));
}

/**
 * The full alarm set a state needs (re-created on startup, SD-1): alarms the state
 * needs are scheduled, every other fb.* alarm is cleared.
 */
export function alarmsFor(state: ActiveState | null, now: number): Effect[] {
  if (state === null || state.session.state === "ENDING") return clearAllAlarms();
  const s = state.session;
  const want: Effect[] = [];
  if (s.state === "ACTIVE") {
    want.push({ type: "ScheduleAlarm", name: "fb.sessionEnd", when: endsAt(s, now) });
    want.push({ type: "ScheduleAlarm", name: "fb.tick", periodMin: TICK_PERIOD_MIN });
  } else if (s.state === "PAUSED") {
    const open = openPause(s);
    want.push({ type: "ScheduleAlarm", name: "fb.stalePause", when: (open?.from ?? now) + STALE_PAUSE_MS });
  } else {
    const open = openPause(s);
    want.push({ type: "ScheduleAlarm", name: "fb.stalePause", when: (open?.from ?? now) + STALE_PAUSE_MS });
    const over = state.notified.breakOver;
    if (over === undefined) want.push({ type: "ScheduleAlarm", name: "fb.breakEnd", when: s.breakEndsAt ?? now });
    else if (state.notified.breakRepeat === undefined) {
      want.push({ type: "ScheduleAlarm", name: "fb.breakPrompt", when: over + BREAK_PROMPT_DELAY_MS });
    }
  }
  const scheduled = new Set(want.map((e) => (e.type === "ScheduleAlarm" ? e.name : "")));
  const clear: Effect[] = ALARM_NAMES.filter((n) => !scheduled.has(n)).map((name) => ({ type: "ClearAlarm", name }));
  return [...want, ...clear];
}
