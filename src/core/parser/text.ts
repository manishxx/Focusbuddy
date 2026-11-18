/**
 * Text normalisation and span helpers shared by the parser steps (PARSER_SPEC §2, §3).
 *
 * `normalise()` returns two strings of the same length: `text` keeps the original
 * casing (used for the label and the objective) and `lower` is the parsing copy.
 * Keeping them index-aligned is what lets every step work in spans: a character
 * whose lowercase form is longer than one code unit (for example "İ") is left as
 * it is, so an index into `lower` is always an index into `text`.
 */
import type { Span } from "./types";

/**
 * NFC, then:
 * - Unicode format characters (`\p{Cf}`: zero-width joiners, bidi overrides) are removed;
 * - control characters (`\p{Cc}`) and line/paragraph separators (`\p{Zl}`, `\p{Zp}`)
 *   become a space, so "line one\nline two" does not turn into one word;
 * - every other space separator (`\p{Zs}`) becomes a space;
 * - runs of spaces collapse to one, and the result is trimmed.
 */
export function normalise(raw: string): { text: string; lower: string } {
  const text = raw
    .normalize("NFC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\p{Zs}]/gu, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return { text, lower: toLowerAligned(text) };
}

/** Lowercase character by character, keeping the length (and so every index) stable. */
export function toLowerAligned(text: string): string {
  let out = "";
  for (const ch of text) {
    const lower = ch === "’" || ch === "ʼ" ? "'" : ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

const WORD = /[\p{L}\p{N}]/u;

export function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}

/** True when `[start, end)` sits on word boundaries in `haystack`. */
export function onWordBoundary(haystack: string, start: number, end: number): boolean {
  return !isWordChar(haystack[start - 1]) && !isWordChar(haystack[end]);
}

/** Every word-boundary occurrence of `needle` in `haystack` (both already lowercase). */
export function findWords(haystack: string, needle: string): Span[] {
  const out: Span[] = [];
  if (needle.length === 0) return out;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) {
    const end = i + needle.length;
    if (onWordBoundary(haystack, i, end)) out.push({ start: i, end });
  }
  return out;
}

export function overlapsAny(span: Span, spans: readonly Span[]): boolean {
  return spans.some((s) => span.start < s.end && s.start < span.end);
}

/** Replaces every span with spaces, so the remaining indices keep their meaning. */
export function blank(text: string, spans: readonly Span[]): string {
  if (spans.length === 0) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const inside = spans.some((s) => i >= s.start && i < s.end);
    out += inside ? " " : (text[i] ?? "");
  }
  return out;
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Drops punctuation left orphaned once spans were blanked out. */
export function stripOrphanPunctuation(text: string): string {
  return collapse(
    text
      // A run of punctuation with nothing but spaces around it.
      .replace(/(^|\s)[^\p{L}\p{N}\s]+(?=\s|$)/gu, " ")
      // Repeated separators ("a , , b" → "a, b"), then leading/trailing ones.
      .replace(/\s*([,;:])(?:\s*[,;:])+/gu, "$1")
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/[\s,;:.\-–—]+$/u, ""),
  );
}

export function capitaliseFirst(text: string): string {
  const first = text[0];
  if (first === undefined) return text;
  const upper = first.toUpperCase();
  return upper.length === first.length ? upper + text.slice(1) : text;
}
