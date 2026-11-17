/**
 * Session time math (ARCHITECTURE §5.1.1 "Time"). Persisted timestamps are the
 * source of truth; nothing here reads a clock.
 *
 *   elapsedMs   = now − startedAt − Σ closed pauses − (open pause ? now − open.from : 0)
 *   totalMs     = (plannedMin + extensionsMin) × 60 000
 *   remainingMs = max(0, totalMs − elapsedMs)
 *   endsAt      = now + remainingMs while ACTIVE / ON_BREAK; PAUSED: open.from + remaining (frozen)
 */
import type { ActiveSession, PauseKind } from "../types";

export const MINUTE_MS = 60_000;
/** A pause this long ends the session with stale_pause (§5.1). */
export const STALE_PAUSE_MS = 4 * 60 * MINUTE_MS;
/** BR-3: the single "Break's over?" repeat comes 5 min after the first prompt. */
export const BREAK_PROMPT_DELAY_MS = 5 * MINUTE_MS;
/** Auto-pause for absence (§5.1, BR-1 amended). */
export const LOCKED_AUTO_PAUSE_MS = 10 * MINUTE_MS;
export const IDLE_AUTO_PAUSE_MS = 30 * MINUTE_MS;
/** Reconciliation: a browser-closed gap longer than this is added to awayMs (D-022). */
export const AWAY_GAP_MS = 2 * MINUTE_MS;
/** Reconciliation: a browser-closed gap this long auto-pauses the session (D-022, D-016). */
export const AWAY_AUTO_PAUSE_MS = 10 * MINUTE_MS;
/** fb.tick period (ARCHITECTURE §7). */
export const TICK_PERIOD_MIN = 0.5;
/** A tick refreshes lastSeenAt once it is this old (see the report: the away gap stays < AWAY_GAP_MS). */
export const LAST_SEEN_REFRESH_MS = MINUTE_MS;
/** Sessions are at most 8 h including extensions (DATA_MODEL §8.1). */
export const MAX_TOTAL_MIN = 480;

type Pauses = ActiveSession["pauses"];

/** The open pause (no `to`), if any. At most one exists (invariant). */
export function openPause(s: Pick<ActiveSession, "pauses">): Pauses[number] | undefined {
  return s.pauses.find((p) => p.to === undefined);
}

export function totalMs(s: Pick<ActiveSession, "plannedMin" | "extensionsMin">): number {
  return (s.plannedMin + s.extensionsMin) * MINUTE_MS;
}

/** Sum of pause time up to `now` (an open pause counts until `now`), optionally of one kind. */
export function pausedMs(s: Pick<ActiveSession, "pauses">, now: number, kind?: PauseKind): number {
  let sum = 0;
  for (const p of s.pauses) {
    if (kind !== undefined && p.kind !== kind) continue;
    const end = p.to ?? Math.max(now, p.from);
    sum += Math.max(0, end - p.from);
  }
  return sum;
}

export function elapsedMs(s: Pick<ActiveSession, "startedAt" | "pauses">, now: number): number {
  return Math.max(0, now - s.startedAt - pausedMs(s, now));
}

export function remainingMs(s: ActiveSession, now: number): number {
  return Math.max(0, totalMs(s) - elapsedMs(s, now));
}

export function endsAt(s: ActiveSession, now: number): number {
  const open = openPause(s);
  if (s.state === "PAUSED" && open !== undefined) return open.from + remainingMs(s, open.from);
  return now + remainingMs(s, now);
}

/** The moment the session clock reached totalMs (≤ now when remaining is 0). */
export function naturalEndAt(s: ActiveSession, now: number): number {
  const over = elapsedMs(s, now) - totalMs(s);
  return over > 0 ? Math.max(s.startedAt, now - over) : now;
}
