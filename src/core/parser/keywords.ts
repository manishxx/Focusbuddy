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
import { bareWord, properNounPhrases, QUANTITY_WORDS, TIME_WORDS, words } from "./subject";
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

/** §9.1: a word that can never be a keyword on its own. */
export function isWeakKeyword(token: string): boolean {
  return (
    STOP_WORDS.has(token) ||
    TIME_WORDS.has(token) ||
    QUANTITY_WORDS.has(token) ||
    GLUE_WORDS.has(token) ||
    /^\p{N}+$/u.test(token)
  );
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

  // §9.1 (a): proper-noun phrases of two to four words, from the subject and the goal.
  for (const source of [subject ?? "", objective]) {
    for (const phrase of properNounPhrases(source)) push(toLowerAligned(phrase));
  }
  // §9.1 (b): the derived subject, when it is two to four words.
  if (subject !== null) {
    const count = words(subject).length;
    if (count >= 2 && count <= 4) push(toLowerAligned(subject).trim());
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
