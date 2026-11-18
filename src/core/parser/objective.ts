/**
 * Objective extraction (PARSER_SPEC §6, FR-T1).
 *
 * The objective is the clause from the first trigger verb to the end of that
 * clause. Original casing is kept, with the verb phrase intact. The duration and
 * mode spans are already blanked out, so "study for 2 hours" gives "Study".
 */
import { LIMITS } from "../storage/validate";
import { collapse, findWords, overlapsAny, stripOrphanPunctuation } from "./text";
import type { Span } from "./types";

/** PARSER_SPEC §6 trigger verbs. */
export const TRIGGER_VERBS: readonly string[] = Object.freeze([
  "finish",
  "complete",
  "read",
  "write",
  "revise",
  "review",
  "study",
  "learn",
  "draft",
  "submit",
  "prepare",
  "practise",
  "practice",
  "solve",
  "watch",
  "summarise",
  "summarize",
  "outline",
  "edit",
  "fix",
  "build",
  "understand",
]);

/** Words that close the clause (PARSER_SPEC §6). */
const BOUNDARY_WORDS: readonly string[] = Object.freeze([
  "and then",
  "then",
  "so that",
  "because",
  "i have",
  "i'll use",
  "i'll be using",
  "i will use",
  "using",
  "help me",
]);

const BOUNDARY_CHARS = ".;,!?";

/** Dangling joiners left when a duration span was blanked out of the clause. */
const TRAILING_JOINERS: readonly string[] = Object.freeze([
  "for",
  "in",
  "on",
  "at",
  "of",
  "to",
  "and",
  "or",
  "about",
  "around",
  "until",
  "till",
  "by",
  "with",
  "the",
  "a",
  "an",
]);

export type ObjectiveResult = {
  /** "" when no trigger verb appears (the caller raises `objective_missing`). */
  objective: string;
  span: Span | null;
  truncated: boolean;
};

/**
 * A boundary character only ends the clause when a space or the end of the text
 * follows it, and when it is not inside a span another step already took. So the
 * dot in "docs.example.com" or in "1.5" does not cut the clause in half.
 */
function clauseEnd(lower: string, from: number, consumed: readonly Span[]): number {
  let end = lower.length;
  for (let i = from; i < lower.length; i++) {
    const ch = lower[i] ?? "";
    if (!BOUNDARY_CHARS.includes(ch)) continue;
    const next = lower[i + 1];
    if (next !== undefined && !/\s/u.test(next)) continue;
    if (consumed.some((sp) => i >= sp.start && i < sp.end)) continue;
    // Not after an abbreviation: "Dr. Smith", "Ph.D. thesis", "30 min." (review F10).
    if (ch === "." && /(?:^|[^\p{L}\p{N}])[\p{L}\p{N}]{1,3}$/u.test(lower.slice(0, i))) continue;
    end = i;
    break;
  }
  for (const word of BOUNDARY_WORDS) {
    for (const span of findWords(lower, word)) {
      if (span.start >= from && span.start < end) end = span.start;
    }
  }
  return end;
}

function dropTrailingJoiners(text: string): string {
  let out = collapse(text);
  for (;;) {
    const match = /\s([\p{L}']+)$/u.exec(out);
    const word = match?.[1]?.toLowerCase();
    if (match === null || word === undefined || !TRAILING_JOINERS.includes(word)) return out;
    out = out.slice(0, match.index);
  }
}

/**
 * `text` keeps the original casing; `lower` is its aligned lowercase copy with the
 * duration and mode spans blanked out, and `consumed` lists those spans.
 */
export function findObjective(text: string, lower: string, consumed: readonly Span[]): ObjectiveResult {
  let verbSpan: Span | null = null;
  for (const verb of TRIGGER_VERBS) {
    for (const span of findWords(lower, verb)) {
      if (overlapsAny(span, consumed)) continue;
      if (verbSpan === null || span.start < verbSpan.start) verbSpan = span;
    }
  }
  if (verbSpan === null) return { objective: "", span: null, truncated: false };

  const end = clauseEnd(lower, verbSpan.end, consumed);
  const span = { start: verbSpan.start, end };
  const raw = dropTrailingJoiners(stripOrphanPunctuation(text.slice(span.start, span.end)));
  if (raw.length === 0) return { objective: "", span: null, truncated: false };
  const truncated = raw.length > LIMITS.objective;
  // Cut on a word boundary where there is one close to the cap.
  let objective = raw;
  if (truncated) {
    const hard = raw.slice(0, LIMITS.objective);
    const lastSpace = hard.lastIndexOf(" ");
    objective = (lastSpace > LIMITS.objective - 30 ? hard.slice(0, lastSpace) : hard).trimEnd();
  }
  return { objective, span, truncated };
}
