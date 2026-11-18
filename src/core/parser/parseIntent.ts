/**
 * The parser pipeline (PARSER_SPEC §3, §10, §11).
 *
 * Pure: `now` and `tzOffsetMin` come from ctx, there is no clock, no `chrome`, no
 * DOM, no network and no AI. The sentence itself is never returned or stored —
 * only the capped draft fields and warnings whose data is short, field-level text.
 */
import { format, type MessageKey } from "../messages";
import type { Mode } from "../types";
import { LIMITS, validateSessionConfig } from "../storage/validate";
import type { SessionDraft } from "../session/types";
import { findDuration } from "./duration";
import { buildKeywords } from "./keywords";
import { buildLabel } from "./label";
import { findObjective } from "./objective";
import { deriveSubject } from "./subject";
import { buildLookup, findSites, SITES } from "./sites";
import { blank, normalise } from "./text";
import {
  WARNING_ORDER,
  WARNING_VALUE_MAX,
  warning,
  type ParseCtx,
  type ParseResult,
  type ParseWarning,
  type Span,
  type WarningCode,
  type WarningField,
} from "./types";

/**
 * The default session length used when the sentence has none. Preferences have no
 * "default session length" field in DATA_MODEL v1.3, and `parse.durationDefaulted`
 * says 60 minutes, so 60 is the value the shell passes in `ctx.defaults`.
 */
export const DEFAULT_PLANNED_MIN = 60;

/** API_CONTRACTS §3: `parse.intent` takes `{text: string ≤ 1000}`. */
export const TEXT_MAX = 1000;

/** PARSER_SPEC §11: every warning code has a message-bank key. */
export const WARNING_MESSAGE_KEYS: Readonly<Record<WarningCode, MessageKey>> = Object.freeze({
  until_passed: "parse.untilPassed",
  duration_conflict: "parse.durationConflict",
  duration_clamped_max: "parse.durationClamped",
  duration_clamped_min: "parse.durationClampedMin",
  duration_defaulted: "parse.durationDefaulted",
  duration_missing: "parse.durationMissing",
  site_sensitive_skipped: "parse.siteSensitiveSkipped",
  site_unrecognised: "parse.siteUnrecognised",
  sites_truncated: "parse.sitesTruncated",
  objective_missing: "parse.objectiveMissing",
  objective_truncated: "parse.objectiveTruncated",
  label_truncated: "parse.labelTruncated",
  label_fallback: "parse.labelFallback",
  keywords_truncated: "parse.keywordsTruncated",
  parse_failed: "parse.safeDraft",
});

/**
 * PARSER_SPEC §7 (D-025): only "<mode> mode" or "be <mode>" sets the mode. A bare
 * "gentle" or "strict" in ordinary prose ("study gentle topics") is not a mode.
 */
const MODE_RE = /\b(?:be\s+(gentle|adaptive|strict)|(gentle|adaptive|strict)\s+mode)\b/;

function findMode(lower: string, consumed: readonly Span[]): { mode: Mode | null; span: Span | null } {
  const match = MODE_RE.exec(lower);
  if (match === null) return { mode: null, span: null };
  const span = { start: match.index, end: match.index + match[0].length };
  if (consumed.some((s) => span.start < s.end && s.start < span.end)) return { mode: null, span: null };
  const mode = match[1] ?? match[2];
  if (mode !== "gentle" && mode !== "adaptive" && mode !== "strict") return { mode: null, span: null };
  return { mode, span };
}

/** At most one warning per field; the §11 order decides which one (PARSER_SPEC §10). */
export function pickWarnings(found: readonly ParseWarning[]): ParseWarning[] {
  const best = new Map<WarningField, ParseWarning>();
  for (const candidate of found) {
    const current = best.get(candidate.field);
    const rank = (w: ParseWarning): number => WARNING_ORDER.indexOf(w.code);
    if (current === undefined || rank(candidate) < rank(current)) best.set(candidate.field, candidate);
  }
  // Stable output order: the §11 code order.
  return [...best.values()].sort((a, b) => WARNING_ORDER.indexOf(a.code) - WARNING_ORDER.indexOf(b.code));
}

function clampPlanned(minutes: number): { plannedMin: number; warning: ParseWarning | null } {
  const whole = Number.isFinite(minutes) ? Math.round(minutes) : LIMITS.plannedMinMin;
  if (whole < LIMITS.plannedMinMin) {
    return {
      plannedMin: LIMITS.plannedMinMin,
      warning: warning("duration_clamped_min", { minutes: LIMITS.plannedMinMin }),
    };
  }
  if (whole > LIMITS.plannedMinMax) {
    return {
      plannedMin: LIMITS.plannedMinMax,
      warning: warning("duration_clamped_max", { minutes: LIMITS.plannedMinMax }),
    };
  }
  return { plannedMin: whole, warning: null };
}

const shorten = (value: string): string =>
  value.length <= WARNING_VALUE_MAX ? value : value.slice(0, WARNING_VALUE_MAX - 1) + "…";

function safeDraft(ctx: ParseCtx): SessionDraft {
  return {
    taskLabel: format("parse.defaultLabel"),
    objective: "",
    allowedHosts: [],
    keywords: [],
    plannedMin: clampPlanned(ctx.defaults.plannedMin).plannedMin,
    mode: ctx.defaults.mode,
  };
}

/** The dictionary lookup is built once: the bundled dictionary never changes. */
const DEFAULT_LOOKUP = buildLookup(SITES);

/**
 * PARSER_SPEC §2: `text` is trimmed, Unicode-normalised and stripped of control and
 * format characters, then run through the §3 pipeline. Text longer than 1,000
 * characters is rejected by the envelope validator before it gets here; a longer
 * string is still handled (it is cut) so the function can never throw.
 */
export function parseIntent(text: string, ctx: ParseCtx): ParseResult {
  const found: ParseWarning[] = [];
  const { text: clean, lower } = normalise(text.slice(0, TEXT_MAX));
  const lookup = ctx.sites === SITES ? DEFAULT_LOOKUP : buildLookup(ctx.sites);

  // ---- 2. duration ----
  const duration = findDuration(lower, ctx);
  found.push(...duration.warnings);
  const consumed: Span[] = [...duration.spans];

  // ---- 3. sites ----
  const sites = findSites(lower, lookup, consumed);
  consumed.push(...sites.spans);
  let allowedHosts = sites.hosts;
  if (allowedHosts.length > LIMITS.allowedHosts) {
    allowedHosts = allowedHosts.slice(0, LIMITS.allowedHosts);
    found.push(warning("sites_truncated", { minutes: LIMITS.allowedHosts }));
  }
  if (sites.sensitive) found.push(warning("site_sensitive_skipped"));
  const unknown = sites.unrecognised[0];
  if (unknown !== undefined) found.push(warning("site_unrecognised", { value: shorten(unknown) }));

  // ---- 4. objective ----
  const durationBlanked = blank(lower, duration.spans);
  const objectiveFound = findObjective(blank(clean, duration.spans), durationBlanked, consumed);
  if (objectiveFound.span !== null) consumed.push(objectiveFound.span);
  if (objectiveFound.objective === "") found.push(warning("objective_missing"));
  if (objectiveFound.truncated) found.push(warning("objective_truncated"));

  // ---- 5. mode ----
  const mode = findMode(lower, consumed);
  if (mode.span !== null) consumed.push(mode.span);

  // ---- 6. task label ----
  const leftover = blank(clean, consumed);
  // §8.1: the subject comes from the goal clause with the site spans blanked out, so
  // a site name ("Khan Academy") can never become the name of the task.
  const objectiveSpan = objectiveFound.span;
  const subject =
    objectiveSpan === null
      ? null
      : deriveSubject(blank(clean, [...duration.spans, ...sites.spans]).slice(objectiveSpan.start, objectiveSpan.end));
  const label = buildLabel(leftover, objectiveFound.objective, subject, clean, format("parse.defaultLabel"));
  if (label.truncated) found.push(warning("label_truncated"));
  if (label.fallback) found.push(warning("label_fallback"));

  // ---- 7. keywords ----
  // A label that is only the bank's default is not the user's words, so it feeds no keywords.
  const keywords = buildKeywords(label.source === "default" ? "" : label.label, objectiveFound.objective, subject);
  if (keywords.truncated) found.push(warning("keywords_truncated", { minutes: keywords.keywords.length }));

  // ---- 8. validate and clamp ----
  if (duration.minutes === null && duration.warnings.length === 0) found.push(warning("duration_defaulted"));
  const clamped = clampPlanned(duration.minutes ?? ctx.defaults.plannedMin);
  if (clamped.warning !== null && duration.minutes !== null) found.push(clamped.warning);

  const draft: SessionDraft = {
    taskLabel: label.label,
    objective: objectiveFound.objective,
    allowedHosts,
    keywords: keywords.keywords,
    plannedMin: clamped.plannedMin,
    mode: mode.mode ?? ctx.defaults.mode,
  };

  const config = validateSessionConfig({
    taskLabel: draft.taskLabel,
    objective: draft.objective,
    allowedHosts: draft.allowedHosts,
    keywords: draft.keywords,
    mode: draft.mode,
  });
  const inRange = draft.plannedMin >= LIMITS.plannedMinMin && draft.plannedMin <= LIMITS.plannedMinMax;
  if (!config.ok || !inRange) {
    // PARSER_SPEC §10: never return an invalid draft. The safe draft throws away every
    // field the other warnings talk about, and `parse_failed` is the one thing the user
    // needs to know, so it is the only warning returned.
    return { draft: safeDraft(ctx), warnings: [warning("parse_failed")] };
  }
  return { draft, warnings: pickWarnings(found) };
}

/** The `mixedUse` flag per allowed host, for the UI and the Day 11 classifier (§5). */
export function mixedUseFor(hosts: readonly string[], sites = SITES): Record<string, boolean> {
  const lookup = sites === SITES ? DEFAULT_LOOKUP : buildLookup(sites);
  const out: Record<string, boolean> = {};
  for (const host of hosts) out[host] = lookup.byHost.get(host)?.mixedUse ?? false;
  return out;
}
