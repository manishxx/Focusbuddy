/**
 * SessionRecord from a session's own times (§5.1.1 ENDING row, Day 07 scope).
 * Activity aggregates are zero until tab observation exists (Day 09+). Only the
 * time-derived fields are filled: `awayMin` = `awayMs` (browser closed, D-022) plus
 * auto_absent pause time (idle/lock auto-pauses), and `breakMin` (breaks). `idleMin`
 * stays 0 because an auto_absent pause doesn't say whether it came from idle or a
 * lock. Minutes are rounded to whole minutes.
 */
import type { ActiveState, EndReason, SessionRecord } from "../types";
import { elapsedMs, MINUTE_MS, pausedMs } from "./time";

const minutes = (ms: number): number => Math.max(0, Math.round(ms / MINUTE_MS));

export function buildSessionRecord(state: ActiveState, endReason: EndReason, endedAt: number): SessionRecord {
  const s = state.session;
  const end = Math.max(endedAt, s.startedAt);
  return {
    id: s.id,
    startedAt: s.startedAt,
    endedAt: end,
    endReason,
    taskLabel: s.taskLabel,
    objective: s.objective,
    mode: s.mode,
    plannedMin: s.plannedMin,
    actualMin: minutes(elapsedMs(s, end)),
    summary: {
      focusedMin: 0,
      uncertainMin: 0,
      driftMin: 0,
      idleMin: 0,
      awayMin: minutes(state.awayMs + pausedMs(s, end, "auto_absent")),
      breakMin: minutes(pausedMs(s, end, "break")),
      excludedMin: 0,
      driftEpisodes: 0,
      recoveries: 0,
      interventions: 0,
      responses: {},
      relevantHosts: [],
      otherMinutes: 0,
    },
  };
}
