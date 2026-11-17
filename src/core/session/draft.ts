/**
 * Payload validation for session commands (API_CONTRACTS §1, §3). Strict: unknown
 * keys fail. Every check reads a plain-data snapshot of the payload (DATA_MODEL §8.1).
 *
 * Error class (review F9, API_CONTRACTS v1.2):
 * - `invalid_argument`: every problem is a value out of range (a number below or
 *   above its bounds or not an integer, a string or list too long or too short);
 * - `invalid_message`: anything else (wrong shape, missing or unknown key, wrong type,
 *   a value outside an enum, a malformed host).
 */
import { trySnapshot } from "../storage/snapshot";
import { Checker, isPlainObject, LIMITS, MODES, validateSessionConfig } from "../storage/validate";
import type { Mode, SessionConfig } from "../types";
import { MAX_TOTAL_MIN } from "./time";

/** API_CONTRACTS §1: keywords ≤ 40 × 60 characters. */
export const DRAFT_KEYWORD_MAX = 60;

export type PayloadError = "invalid_message" | "invalid_argument";
type Parsed<T> = { ok: true; value: T } | { ok: false; error: PayloadError };

/** Checker codes that mean "the value is out of range" rather than "the message is malformed". */
const RANGE_CODES = new Set(["below_min", "above_max", "not_integer", "too_long", "too_short", "too_many"]);

/** Classifies `<path>:<code>` errors. */
export function classifyErrors(errors: readonly string[]): PayloadError {
  const codes = errors.map((e) => e.slice(e.lastIndexOf(":") + 1));
  return codes.length > 0 && codes.every((c) => RANGE_CODES.has(c)) ? "invalid_argument" : "invalid_message";
}

const MALFORMED = { ok: false, error: "invalid_message" } as const;

const DRAFT_KEYS = ["taskLabel", "objective", "allowedHosts", "keywords", "plannedMin"] as const;

/** `{draft: SessionDraft}` → a SessionConfig (mode filled from `defaultMode`) plus plannedMin. */
export function parseStartPayload(
  payload: unknown,
  defaultMode: Mode,
): Parsed<{ config: SessionConfig; plannedMin: number }> {
  const snap = trySnapshot(payload);
  if (!snap.ok || !isPlainObject(snap.value)) return MALFORMED;
  const c = new Checker();
  const outer = c.obj(snap.value, "payload", ["draft"]);
  const d = c.obj(outer.draft, "draft", DRAFT_KEYS, ["nextStep", "mode"]);
  if (c.errors.length > 0) return MALFORMED;
  const plannedMin = c.int(d.plannedMin, "draft.plannedMin", LIMITS.plannedMinMin, MAX_TOTAL_MIN);
  const mode = d.mode === undefined ? defaultMode : c.oneOf(d.mode, "draft.mode", MODES);
  if (Array.isArray(d.keywords)) {
    const kws: unknown[] = d.keywords;
    for (const k of kws)
      if (typeof k === "string" && k.length > DRAFT_KEYWORD_MAX) c.fail("draft.keywords", "too_long");
  }
  const config = validateSessionConfig({
    taskLabel: d.taskLabel,
    objective: d.objective,
    allowedHosts: d.allowedHosts,
    keywords: d.keywords,
    mode,
    ...(d.nextStep !== undefined && { nextStep: d.nextStep }),
  });
  const errors = [...c.errors, ...(config.ok ? [] : config.errors)];
  if (errors.length > 0 || !config.ok) return { ok: false, error: classifyErrors(errors) };
  return { ok: true, value: { config: config.value, plannedMin } };
}

/** `{}` exactly. */
export function parseEmpty(payload: unknown): boolean {
  const snap = trySnapshot(payload);
  return snap.ok && isPlainObject(snap.value) && Object.keys(snap.value).length === 0;
}

/** `{minutes}` with an integer in [min, max]. */
export function parseMinutes(payload: unknown, min: number, max: number): Parsed<number> {
  const snap = trySnapshot(payload);
  if (!snap.ok) return MALFORMED;
  const c = new Checker();
  const o = c.obj(snap.value, "payload", ["minutes"]);
  if (c.errors.length > 0) return MALFORMED;
  const minutes = c.int(o.minutes, "payload.minutes", min, max);
  return c.errors.length === 0 ? { ok: true, value: minutes } : { ok: false, error: classifyErrors(c.errors) };
}

/** `{objective?, nextStep?}` with the stored length caps. */
export function parseNote(payload: unknown): Parsed<{ objective?: string; nextStep?: string }> {
  const snap = trySnapshot(payload);
  if (!snap.ok) return MALFORMED;
  const c = new Checker();
  const o = c.obj(snap.value, "payload", [], ["objective", "nextStep"]);
  if (c.errors.length > 0) return MALFORMED;
  const objective = o.objective === undefined ? undefined : c.str(o.objective, "payload.objective", LIMITS.objective);
  const nextStep = o.nextStep === undefined ? undefined : c.str(o.nextStep, "payload.nextStep", LIMITS.nextStep);
  if (c.errors.length > 0) return { ok: false, error: classifyErrors(c.errors) };
  return {
    ok: true,
    value: { ...(objective !== undefined && { objective }), ...(nextStep !== undefined && { nextStep }) },
  };
}
