/**
 * Turns reducer placeholder values into message-bank strings. Clock times use the
 * device's local time zone (the core stays pure); durations round up to minutes.
 */
import type { FxVars } from "../../core/session";
import { format, type MessageKey, type MessageVars } from "../../core/messages";

const MINUTE = 60_000;

/** "45 min", "1 h", "2 h 5 min". Rounds up, so "1 min" is shown until time is really up. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / MINUTE));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export function formatClock(at: number): string {
  return clockFormat.format(at);
}

export function resolveVars(vars: FxVars): MessageVars {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) {
    out[k] = typeof v === "object" ? (v.kind === "clock" ? formatClock(v.at) : formatDuration(v.ms)) : v;
  }
  return out;
}

export function text(key: MessageKey, vars: FxVars): string {
  return format(key, resolveVars(vars));
}
