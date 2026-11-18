/**
 * Types for the task parser (PARSER_SPEC §2, §11).
 *
 * Everything here is data: the parser is pure (no clock, no `chrome`, no DOM),
 * so `now` and `tzOffsetMin` are injected through ParseCtx.
 */
import type { SessionDraft } from "../session/types";
import type { Mode } from "../types";

/** A half-open range `[start, end)` of the normalised text. */
export type Span = { start: number; end: number };

/** PARSER_SPEC §5: one bundled site, with the `mixedUse` flag the Day 11 classifier needs. */
export type SiteEntry = {
  /** Normalised host: lowercase, no "www.", passes the Day 06 host validator. */
  host: string;
  /** Spoken forms, lowercase. Longer names are matched first. */
  names: readonly string[];
  /** The classifier needs the title to judge this host (ARCHITECTURE §5.3 step 8). */
  mixedUse: boolean;
};

export type SiteDictionary = readonly SiteEntry[];

export type ParseCtx = {
  /** Epoch ms, injected (the parser never reads a clock). */
  now: number;
  /** Minutes to add to UTC for local time, injected. */
  tzOffsetMin: number;
  defaults: { plannedMin: number; mode: Mode };
  sites: SiteDictionary;
};

export type WarningField = "plannedMin" | "allowedHosts" | "objective" | "taskLabel" | "keywords";

/** PARSER_SPEC §11, in precedence order within a field. */
export type WarningCode =
  | "until_passed"
  | "duration_conflict"
  | "duration_clamped_max"
  | "duration_clamped_min"
  | "duration_defaulted"
  | "duration_missing"
  | "site_sensitive_skipped"
  | "site_unrecognised"
  | "sites_truncated"
  | "objective_missing"
  | "objective_truncated"
  | "label_truncated"
  | "label_fallback"
  | "keywords_truncated"
  | "parse_failed";

/** Never the whole sentence (PARSER_SPEC §2, principle 3). */
export type ParseWarningData = { value?: string; minutes?: number; count?: number; names?: string[] };

export type ParseWarning = {
  code: WarningCode;
  field: WarningField;
  data?: ParseWarningData;
};

export type ParseResult = {
  /** SessionConfig & { plannedMin }: always valid (PARSER_SPEC §10). */
  draft: SessionDraft;
  warnings: ParseWarning[];
};

/** The field each warning code belongs to, and the §11 precedence order. */
export const WARNING_FIELDS: Readonly<Record<WarningCode, WarningField>> = Object.freeze({
  until_passed: "plannedMin",
  duration_conflict: "plannedMin",
  duration_clamped_max: "plannedMin",
  duration_clamped_min: "plannedMin",
  duration_defaulted: "plannedMin",
  duration_missing: "plannedMin",
  site_sensitive_skipped: "allowedHosts",
  site_unrecognised: "allowedHosts",
  sites_truncated: "allowedHosts",
  objective_missing: "objective",
  objective_truncated: "objective",
  label_truncated: "taskLabel",
  label_fallback: "taskLabel",
  keywords_truncated: "keywords",
  parse_failed: "taskLabel",
});

/** §11 order: earlier codes win inside one field (at most one warning per field). */
export const WARNING_ORDER: readonly WarningCode[] = Object.freeze([
  "until_passed",
  "duration_conflict",
  "duration_clamped_max",
  "duration_clamped_min",
  "duration_defaulted",
  "duration_missing",
  "site_sensitive_skipped",
  "site_unrecognised",
  "sites_truncated",
  "objective_missing",
  "objective_truncated",
  "label_truncated",
  "label_fallback",
  "keywords_truncated",
  "parse_failed",
]);

export const WARNING_CODES: readonly WarningCode[] = WARNING_ORDER;

/** Longest value a warning may echo, so a warning can never carry the sentence. */
export const WARNING_VALUE_MAX = 24;
/** Most items a warning's `names` list may carry. */
export const WARNING_NAMES_MAX = 3;

export function warning(code: WarningCode, data?: ParseWarningData): ParseWarning {
  return { code, field: WARNING_FIELDS[code], ...(data !== undefined && { data }) };
}
