/**
 * Duration grammar (PARSER_SPEC §4, FR-T1, BR-5).
 *
 * Every accepted form is one pattern. All patterns are scanned, the matches are
 * resolved left to right (longer match first on a tie), and the **first** match
 * in the text decides `plannedMin`; the rest raise `duration_conflict`.
 *
 * Clock targets ("until 5pm") are computed from `now + tzOffsetMin`, never from a
 * clock: a target at or before `now` does not silently roll over to tomorrow but
 * raises `until_passed` (BR-5). A bare "until 5" is ambiguous and raises
 * `duration_missing` instead of guessing.
 */
import type { ParseWarning, Span } from "./types";
import { WARNING_NAMES_MAX, WARNING_VALUE_MAX, warning } from "./types";

export const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

/** PARSER_SPEC §4: one to twelve, plus the round numbers people say. */
export const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  "forty-five": 45,
  "forty five": 45,
  fortyfive: 45,
  sixty: 60,
  ninety: 90,
});

const INT_WORDS = Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");
/**
 * Hours also accept "a"/"an" ("an hour"). Up to nine digits: an absurd magnitude is
 * matched and then clamped by §10, never left to leak into the label (review F11).
 */
const HOUR_NUM = `(?:${INT_WORDS}|an|a|\\d{1,9})`;
const MIN_NUM = `(?:${INT_WORDS}|\\d{1,9})`;
const H_UNIT = "(?:hours|hour|hrs|hr|h)";
const M_UNIT = "(?:minutes|minute|mins|min|m)";

function numberOf(word: string): number | null {
  const text = word.trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "a" || text === "an") return 1;
  return NUMBER_WORDS[text] ?? null;
}

type Candidate = {
  start: number;
  end: number;
  /** null when the form is time-like but too vague ("until 5"). */
  minutes: number | null;
  /** A clock target that already passed today (BR-5). */
  passed: boolean;
  /** The matched text, for `duration_conflict` (short by construction). */
  text: string;
  /** Pattern order, to break ties deterministically. */
  rank: number;
};

export type DurationCtx = { now: number; tzOffsetMin: number };

/** Local wall-clock target today, in epoch ms. `hour24` may be 24 (midnight tonight). */
export function clockTarget(ctx: DurationCtx, hour24: number, minute: number): number {
  const localNow = ctx.now + ctx.tzOffsetMin * MS_PER_MIN;
  const dayStart = Math.floor(localNow / MS_PER_DAY) * MS_PER_DAY;
  const localTarget = dayStart + hour24 * 60 * MS_PER_MIN + minute * MS_PER_MIN;
  return localTarget - ctx.tzOffsetMin * MS_PER_MIN;
}

function clockCandidate(ctx: DurationCtx, hour24: number, minute: number): { minutes: number | null; passed: boolean } {
  const target = clockTarget(ctx, hour24, minute);
  if (target <= ctx.now) return { minutes: null, passed: true };
  return { minutes: Math.round((target - ctx.now) / MS_PER_MIN), passed: false };
}

type Pattern = {
  re: RegExp;
  read: (m: RegExpExecArray, ctx: DurationCtx) => { minutes: number | null; passed?: boolean } | null;
};

/** Ordered: the first pattern wins when two matches start at the same place. */
const PATTERNS: readonly Pattern[] = [
  // "half an hour", "half hour"
  { re: /\bhalf\s+(?:an?\s+)?hour\b/g, read: () => ({ minutes: 30 }) },
  // "a couple of hours"
  { re: /\b(?:a\s+)?couple\s+(?:of\s+)?hours\b/g, read: () => ({ minutes: 120 }) },
  // §4.1: "an hour and a half", "2 hours and a half" — one duration, whole span consumed
  {
    re: new RegExp(`\\b(${HOUR_NUM})\\s*${H_UNIT}\\s+and\\s+a\\s+half\\b`, "g"),
    read: (m) => {
      const h = numberOf(m[1] ?? "");
      return h === null ? null : { minutes: h * 60 + 30 };
    },
  },
  // §4.1: "two and a half hours"
  {
    re: new RegExp(`\\b(${HOUR_NUM})\\s+and\\s+a\\s+half\\s+${H_UNIT}\\b`, "g"),
    read: (m) => {
      const h = numberOf(m[1] ?? "");
      return h === null ? null : { minutes: h * 60 + 30 };
    },
  },
  // "1 hour 30 minutes", "1h 30m"
  {
    re: new RegExp(`\\b(${HOUR_NUM})\\s*${H_UNIT}\\s*(?:and\\s+)?(${MIN_NUM})\\s*${M_UNIT}\\b`, "g"),
    read: (m) => {
      const h = numberOf(m[1] ?? "");
      const min = numberOf(m[2] ?? "");
      return h === null || min === null ? null : { minutes: h * 60 + min };
    },
  },
  // "1h30", "2h15" (compact only: no minute unit, at most one space)
  {
    re: /\b(\d{1,3})\s?(?:hrs|hr|h)\s?(\d{1,2})\b(?!\s*(?:minutes|minute|mins|min|m)\b)/g,
    read: (m) => {
      const h = Number(m[1]);
      const min = Number(m[2]);
      return { minutes: h * 60 + min };
    },
  },
  // "1.5h", "1,5 h", "2.25 hours"
  {
    re: new RegExp(`\\b(\\d{1,3})[.,](\\d{1,2})\\s*${H_UNIT}\\b`, "g"),
    read: (m) => ({ minutes: Math.round(Number(`${m[1] ?? "0"}.${m[2] ?? "0"}`) * 60) }),
  },
  // "3 hours", "3h", "an hour", "two hours"
  {
    re: new RegExp(`\\b(${HOUR_NUM})\\s*${H_UNIT}\\b`, "g"),
    read: (m) => {
      const h = numberOf(m[1] ?? "");
      return h === null ? null : { minutes: h * 60 };
    },
  },
  // "90 min", "45m", "ninety minutes"
  {
    re: new RegExp(`\\b(${MIN_NUM})\\s*${M_UNIT}\\b`, "g"),
    read: (m) => {
      const min = numberOf(m[1] ?? "");
      return min === null ? null : { minutes: min };
    },
  },
  // "until noon", "until midnight"
  {
    re: /\b(?:until|untill|till|til|by)\s+(noon|midnight)\b/g,
    read: (m, ctx) => {
      const found = clockCandidate(ctx, m[1] === "noon" ? 12 : 24, 0);
      return { minutes: found.minutes, passed: found.passed };
    },
  },
  // "until 5pm", "till 17:00", "until 5:30 pm", "by 9am" — and the ambiguous "until 5"
  {
    re: /\b(?:until|untill|till|til|by)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?!\s*(?:hours|hour|hrs|hr|h|minutes|minute|mins|min|m)\b)/g,
    read: (m, ctx) => {
      const hour = Number(m[1]);
      const minute = m[2] === undefined ? 0 : Number(m[2]);
      const suffix = (m[3] ?? "").replace(/\./g, "");
      if (suffix === "" && m[2] === undefined) return { minutes: null }; // "until 5": too vague
      if (hour > 23 || minute > 59) return { minutes: null };
      let hour24 = hour;
      if (suffix === "pm") hour24 = hour === 12 ? 12 : hour + 12;
      else if (suffix === "am") hour24 = hour === 12 ? 0 : hour;
      const found = clockCandidate(ctx, hour24, minute);
      return { minutes: found.minutes, passed: found.passed };
    },
  },
];

/**
 * Words people put in front of a duration ("for the next 2 hours", "in about 90
 * min"). They are part of the duration phrase, so they leave the label too.
 */
const LEAD_WORDS: readonly string[] = Object.freeze([
  "for",
  "the",
  "next",
  "about",
  "around",
  "in",
  "of",
  "within",
  "roughly",
  "maybe",
  "over",
]);

/**
 * Grows a span leftwards over up to three lead words (see LEAD_WORDS), and
 * rightwards over a following "of" ("two and a half hours **of** notes"), so a
 * duration in the middle of a clause leaves no dangling joiner behind.
 */
export function expandLead(lower: string, span: Span): Span {
  let start = span.start;
  for (let i = 0; i < 3; i++) {
    const before = lower.slice(0, start).replace(/\s+$/u, "");
    const match = /([\p{L}']+)$/u.exec(before);
    const word = match?.[1];
    if (match === null || word === undefined || !LEAD_WORDS.includes(word)) break;
    start = match.index;
  }
  let end = span.end;
  const after = /^(\s+of)\b/u.exec(lower.slice(end));
  if (after !== null) end += (after[1] ?? "").length;
  return { start, end };
}

export type DurationResult = {
  /** null when nothing usable was found (the caller applies the default). */
  minutes: number | null;
  spans: Span[];
  warnings: ParseWarning[];
};

const shorten = (text: string): string =>
  text.length <= WARNING_VALUE_MAX ? text : text.slice(0, WARNING_VALUE_MAX - 1) + "…";

/**
 * Scans every form, then resolves overlaps left to right.
 *
 * Resolution (PARSER_SPEC §4 "Conflicts", made precise here):
 * - the first match that carries a value sets `plannedMin`;
 * - if the first match of all is a passed clock target → `until_passed`;
 * - else if no match carries a value → `duration_missing`;
 * - else if more than one match was found → `duration_conflict`, listing what was ignored.
 */
export function findDuration(lower: string, ctx: DurationCtx): DurationResult {
  const found: Candidate[] = [];
  PATTERNS.forEach((pattern, rank) => {
    pattern.re.lastIndex = 0;
    for (let m = pattern.re.exec(lower); m !== null; m = pattern.re.exec(lower)) {
      const read = pattern.read(m, ctx);
      if (read === null) continue;
      found.push({
        start: m.index,
        end: m.index + m[0].length,
        minutes: read.minutes,
        passed: read.passed === true,
        text: m[0],
        rank,
      });
    }
  });

  // Left to right; on the same start the longer match wins, then the earlier pattern.
  found.sort((a, b) => a.start - b.start || b.end - a.end || a.rank - b.rank);
  const kept: Candidate[] = [];
  for (const candidate of found) {
    if (kept.some((k) => candidate.start < k.end && k.start < candidate.end)) continue;
    kept.push(candidate);
  }

  const spans = kept.map(({ start, end }) => expandLead(lower, { start, end }));
  const first = kept[0];
  if (first === undefined) return { minutes: null, spans, warnings: [] };

  const valued = kept.find((c) => c.minutes !== null);
  if (first.passed) {
    return { minutes: null, spans, warnings: [warning("until_passed", { value: shorten(first.text) })] };
  }
  if (valued === undefined) {
    return { minutes: null, spans, warnings: [warning("duration_missing", { value: shorten(first.text) })] };
  }
  const ignored = kept.filter((c) => c !== valued).map((c) => shorten(c.text));
  const warnings =
    ignored.length > 0
      ? [
          warning("duration_conflict", {
            minutes: valued.minutes ?? 0,
            names: ignored.slice(0, WARNING_NAMES_MAX),
          }),
        ]
      : [];
  return { minutes: valued.minutes, spans, warnings };
}
