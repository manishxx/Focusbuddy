/**
 * Keywords (PARSER_SPEC §9, §9.1, FR-C4 input).
 *
 * The user's own words only: nothing is expanded, stemmed or invented. §9.1 (D-025)
 * tightens what counts, because a weak keyword causes false RELEVANT results on
 * Day 11: phrases come only from a proper-noun phrase or the derived subject, and
 * time, quantity and filler words are never keywords.
 */
import { LIMITS } from "../storage/validate";
import { GLUE_WORDS } from "./label";
import { TRIGGER_VERBS } from "./objective";
import {
  bareWord,
  FUNCTION_WORDS,
  isNumericToken,
  properNounPhrases,
  QUANTITY_WORDS,
  TIME_WORDS,
  words,
} from "./subject";
import { toLowerAligned } from "./text";

/** PARSER_SPEC §9 cap here; the validator allows 40, the rest is room for the user. */
export const KEYWORDS_MAX = 12;

const ARTICLES: readonly string[] = ["a", "an", "the"];

/** Articles, pronouns, prepositions, the trigger verbs, chapter/page words. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  ...ARTICLES,
  ...TRIGGER_VERBS,
  "about",
  "after",
  "all",
  "and",
  "any",
  "are",
  "around",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "but",
  "by",
  "can",
  "chapter",
  "chapters",
  "did",
  "do",
  "does",
  "down",
  "during",
  "each",
  "every",
  "for",
  "from",
  "get",
  "got",
  "had",
  "has",
  "have",
  "he",
  "her",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "mine",
  "more",
  "most",
  "my",
  "need",
  "next",
  "not",
  "of",
  "off",
  "on",
  "one",
  "onto",
  "or",
  "our",
  "ours",
  "out",
  "over",
  "page",
  "pages",
  "she",
  "so",
  "some",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "under",
  "until",
  "up",
  "us",
  "use",
  "using",
  "very",
  "want",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
]);

/**
 * §9.2: generic web and filler words. A keyword like `home` next to a mixed-use host
 * would classify a site's home page as RELEVANT, which is the FR-C6 failure the PRD
 * cares most about, so these never stand alone.
 */
export const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "com",
  "focus",
  "home",
  "how",
  "http",
  "https",
  "net",
  "news",
  "online",
  "org",
  "page",
  "pages",
  "site",
  "stuff",
  "thing",
  "things",
  "video",
  "videos",
  "web",
  "website",
  "what",
  "why",
  "work",
  "www",
]);

/** §9.2: a clock-shaped token ("5pm", "17:00", "9 am" after tokenising). */
const CLOCK_SHAPED = /^(?:[0-9]{1,2}[.:][0-9]{2}|[0-9]{1,4}(?:am|pm)|am|pm)$/;

/** §9.1, §9.2: a word that can never be a keyword on its own. */
export function isWeakKeyword(token: string): boolean {
  return (
    STOP_WORDS.has(token) ||
    TIME_WORDS.has(token) ||
    QUANTITY_WORDS.has(token) ||
    GLUE_WORDS.has(token) ||
    GENERIC_WORDS.has(token) ||
    FUNCTION_WORDS.has(token) ||
    CLOCK_SHAPED.test(token) ||
    isNumericToken(token) ||
    // A token that starts with a digit is a measurement or an id, never a topic
    // ("1e9", "1h30", "5pm", "2x").
    /^[0-9]/.test(token)
  );
}

/**
 * §9.2: a phrase is rejected when its first or last token is weak, or when every
 * token is weak. So "for the biology exam", "in strict mode", "and write",
 * "chapter 5 page 9" and "how to code" never become keywords.
 */
export function isWeakPhrase(phrase: string): boolean {
  const raw = words(phrase);
  // A dot inside a phrase means an abbreviation or a host fragment ("dr. smith's ph.d",
  // "sub.mail.google.com"), never a topic.
  if (raw.some((w) => w.includes("."))) return true;
  const list = raw.map((w) => bareWord(w));
  const first = list[0];
  const last = list[list.length - 1];
  if (first === undefined || last === undefined) return true;
  if (isWeakKeyword(first) || isWeakKeyword(last)) return true;
  return list.every((w) => isWeakKeyword(w));
}

const TOKEN = /[\p{L}\p{N}]+/gu;

function tokens(text: string): string[] {
  return toLowerAligned(text).match(TOKEN) ?? [];
}

/** The subject phrase of a label, with the trigger verb and the articles removed (§8). */
export function subjectPhrase(label: string): string {
  const list = tokens(label).filter(
    (word, i) => !(i === 0 && TRIGGER_VERBS.includes(word)) && !ARTICLES.includes(word),
  );
  return list.join(" ");
}

export type KeywordsResult = { keywords: string[]; truncated: boolean };

/**
 * Phrases first (a title match needs them), then single words of three or more
 * characters that are not weak, de-duplicated, in order, capped at 12.
 *
 * `subject` is the §8.1 subject: it is both a phrase candidate and the first source
 * of single words, so the user's topic leads the list.
 */
export function buildKeywords(label: string, objective: string, subject: string | null = null): KeywordsResult {
  const candidates: string[] = [];
  const push = (value: string): void => {
    const keyword = value.trim();
    if (keyword.length === 0 || keyword.length > LIMITS.keywordLength) return;
    if (!candidates.includes(keyword)) candidates.push(keyword);
  };

  const pushPhrase = (value: string): void => {
    const phrase = toLowerAligned(value).trim();
    if (!isWeakPhrase(phrase)) push(phrase);
  };
  // §9.1 (a): proper-noun phrases of two to four words, from the subject and the goal.
  for (const source of [subject ?? "", objective]) {
    for (const phrase of properNounPhrases(source)) pushPhrase(phrase);
  }
  // §9.1 (b): the derived subject, when it is two to four words.
  if (subject !== null) {
    const count = words(subject).length;
    if (count >= 2 && count <= 4) pushPhrase(subject);
  }

  for (const source of [subject ?? "", label, objective]) {
    for (const token of tokens(source)) {
      if (token.length < 3) continue;
      if (isWeakKeyword(bareWord(token))) continue;
      push(token);
    }
  }

  const truncated = candidates.length > KEYWORDS_MAX;
  return { keywords: candidates.slice(0, KEYWORDS_MAX), truncated };
}
