/**
 * Subject derivation (PARSER_SPEC §8.1, §9.1, D-025).
 *
 * The confirm form shows Task and Goal separately: the Task is the *subject* the
 * user is working on ("Pattern Recognition"), not the goal clause ("Finish the
 * first four chapters of Pattern Recognition today"). This module turns an
 * objective clause into that subject, and holds the word classes §8.1 and §9.1
 * share (determiners, quantities, time words, subordinators).
 */
import { TRIGGER_VERBS } from "./objective";
import { capitaliseFirst, collapse, stripOrphanPunctuation, toLowerAligned } from "./text";

/** Leading determiners and possessives (§8.1 step 1). */
export const DETERMINERS: ReadonlySet<string> = new Set([
  "a",
  "all",
  "an",
  "any",
  "both",
  "each",
  "every",
  "her",
  "his",
  "its",
  "my",
  "our",
  "some",
  "that",
  "the",
  "their",
  "these",
  "this",
  "those",
  "your",
]);

/** Quantity words and number words (§8.1 step 1, §9.1). */
export const QUANTITY_WORDS: ReadonlySet<string> = new Set([
  "couple",
  "eight",
  "eleven",
  "few",
  "fifteen",
  "first",
  "five",
  "forty",
  "four",
  "fourth",
  "half",
  "last",
  "many",
  "more",
  "most",
  "next",
  "nine",
  "ninety",
  "one",
  "second",
  "seven",
  "several",
  "six",
  "sixty",
  "ten",
  "third",
  "thirty",
  "three",
  "twelve",
  "twenty",
  "two",
]);

/** Time words (§8.1 step 1 trailing, §9.1). */
export const TIME_WORDS: ReadonlySet<string> = new Set([
  "afternoon",
  "asap",
  "day",
  "days",
  "deadline",
  "due",
  "evening",
  "hour",
  "hours",
  "later",
  "minute",
  "minutes",
  "month",
  "morning",
  "night",
  "now",
  "soon",
  "today",
  "tomorrow",
  "tonight",
  "week",
  "weekend",
  "yesterday",
]);

/** Subordinating conjunctions: a clause starting with one is never the label (§8.1 step 2). */
export const SUBORDINATORS: ReadonlySet<string> = new Set([
  "after",
  "although",
  "as",
  "because",
  "before",
  "due",
  "if",
  "once",
  "since",
  "so",
  "though",
  "unless",
  "until",
  "when",
  "whereas",
  "while",
]);

/** Dangling joiners, also used when a removed span leaves one behind. */
export const JOINERS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "an",
  "and",
  "around",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "till",
  "to",
  "until",
  "with",
]);

/**
 * Contractions and stray adverbs (§9.0, D-027). The `n't` fragment is listed too,
 * because tokenising "don't" on non-letters leaves "don" and "t".
 */
export const CONTRACTIONS_AND_ADVERBS: readonly string[] = [
  "already",
  "aren't",
  "can't",
  "cannot",
  "couldn't",
  "didn't",
  "doesn't",
  "don",
  "don't",
  "hasn't",
  "haven't",
  "isn't",
  "just",
  "n't",
  "nt",
  "really",
  "shouldn't",
  "thanks",
  "wasn't",
  "weren't",
  "won't",
  "wouldn't",
];

/**
 * The product's own words: "focus" names the app, not the user's task, so it is
 * never a label on its own and never a keyword (§9.0 lists it as generic).
 */
const APP_WORDS: readonly string[] = ["focus", "focused", "focusing", "focussed", "focussing"];

/** Question words and discourse markers (§8.1 step 4). */
export const QUESTION_WORDS: ReadonlySet<string> = new Set([
  ...CONTRACTIONS_AND_ADVERBS,
  ...APP_WORDS,
  "actually",
  "am",
  "are",
  "be",
  "been",
  "being",
  "can",
  "could",
  "did",
  "do",
  "does",
  "had",
  "has",
  "have",
  "having",
  "is",
  "may",
  "might",
  "must",
  "shall",
  "should",
  "then",
  "thing",
  "things",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "will",
  "would",
  "how",
]);

/** Prepositions and conjunctions beyond the joiners above (§8.1 step 4). */
const PREPOSITIONS_AND_CONJUNCTIONS: readonly string[] = [
  "above",
  "across",
  "after",
  "against",
  "along",
  "also",
  "among",
  "as",
  "before",
  "behind",
  "below",
  "beneath",
  "beside",
  "between",
  "beyond",
  "but",
  "down",
  "during",
  "inside",
  "into",
  "just",
  "near",
  "nor",
  "off",
  "onto",
  "out",
  "outside",
  "over",
  "past",
  "please",
  "really",
  "so",
  "than",
  "through",
  "to",
  "toward",
  "towards",
  "under",
  "up",
  "upon",
  "within",
  "without",
  "yet",
];

/** Pronouns that can be left dangling at either end of a leftover. */
const PRONOUNS: readonly string[] = [
  "he",
  "her",
  "him",
  "his",
  "i",
  "it",
  "its",
  "me",
  "my",
  "our",
  "she",
  "that",
  "their",
  "them",
  "these",
  "they",
  "this",
  "those",
  "us",
  "we",
  "you",
  "your",
];

/**
 * §8.1 step 4: words that carry no task on their own. A label never starts or ends
 * with one, and never consists only of them.
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  ...DETERMINERS,
  ...JOINERS,
  ...QUESTION_WORDS,
  ...SUBORDINATORS,
  ...PREPOSITIONS_AND_CONJUNCTIONS,
  ...PRONOUNS,
]);

/** §8.1 step 5: a token that is only a number, including "1e9", "1,5" and "17:00". */
const NUMERIC_TOKEN = /^[0-9]+(?:[.,:][0-9]+)*(?:e[+-]?[0-9]+)?$/i;

export function isNumericToken(word: string): boolean {
  return NUMERIC_TOKEN.test(bareWord(word));
}

/** True when every word is a function word or a number (§8.1 steps 4, 5). */
export function isAllFunctionWords(text: string): boolean {
  const list = words(text);
  if (list.length === 0) return true;
  return list.every((w) => {
    const bare = bareWord(w);
    return bare.length === 0 || FUNCTION_WORDS.has(bare) || isNumericToken(bare) || TIME_WORDS.has(bare);
  });
}

/**
 * §8.1 step 4: strips dangling function words, determiners, prepositions,
 * conjunctions, question words and bare numbers from **both** ends, iteratively.
 * Returns "" when nothing of substance is left.
 */
export function stripFunctionWords(text: string): string {
  let list = words(stripOrphanPunctuation(text));
  const danglingAt = (i: number): boolean => {
    const word = list[i];
    if (word === undefined) return false;
    const bare = bareWord(word);
    return bare.length === 0 || FUNCTION_WORDS.has(bare) || isNumericToken(bare) || TIME_WORDS.has(bare);
  };
  for (;;) {
    if (list.length === 0) return "";
    if (danglingAt(0)) {
      list = list.slice(1);
      continue;
    }
    if (danglingAt(list.length - 1)) {
      list = list.slice(0, -1);
      continue;
    }
    break;
  }
  const out = stripOrphanPunctuation(list.join(" "));
  return isAllFunctionWords(out) ? "" : out;
}

const WORD_CHARS = /[^\p{L}\p{N}'-]/gu;

/** A word with its surrounding punctuation removed, lowercased. */
export function bareWord(word: string): string {
  return toLowerAligned(word).replace(WORD_CHARS, "");
}

/** Splits on whitespace, keeping the original casing. */
export function words(text: string): string[] {
  return collapse(text)
    .split(" ")
    .filter((w) => w.length > 0);
}

/**
 * A run of 2–4 capitalised words: a proper-noun phrase (§8.1 step 1, §9.1). A single
 * lowercase connector may sit inside one ("Treaty of Westphalia"), but never at
 * either end.
 */
// "and" and "or" are deliberately not connectors: they would join two separate
// names into one phrase ("Google Scholar and Google Docs").
const CONNECTOR = "(?:of|the|de|von|van|da|di)";
const CAPITALISED_RUN = new RegExp(
  `\\p{Lu}[\\p{L}\\p{N}.'-]*(?:[ -](?:${CONNECTOR} )?\\p{Lu}[\\p{L}\\p{N}.'-]*){1,3}`,
  "gu",
);

/** Proper-noun phrases of two to four words, in the order they appear. */
export function properNounPhrases(text: string): string[] {
  const out: string[] = [];
  for (const match of text.match(CAPITALISED_RUN) ?? []) {
    const phrase = stripOrphanPunctuation(match);
    const list = words(phrase);
    // A run that starts with a trigger verb is a capitalised sentence opening
    // ("Read the Kafka notes"), not a name.
    const first = list[0];
    if (first !== undefined && TRIGGER_VERBS.includes(bareWord(first))) continue;
    // Single letters are initials or list markers, not a name ("A B C D").
    if (list.some((w) => bareWord(w).length < 2)) continue;
    if (list.length >= 2 && list.length <= 4 && !out.includes(phrase)) out.push(phrase);
  }
  return out;
}

/** True when a clause begins with a subordinating conjunction (§8.1 step 2). */
export function startsWithSubordinator(text: string): boolean {
  const first = words(text)[0];
  return first !== undefined && SUBORDINATORS.has(bareWord(first));
}

/** Compares two strings as the user would read them: case and punctuation ignored. */
export function sameText(a: string, b: string): boolean {
  const key = (v: string) => toLowerAligned(v).replace(/[^\p{L}\p{N}]+/gu, "");
  const ka = key(a);
  return ka.length > 0 && ka === key(b);
}

/**
 * §8.1 step 1: the subject of an objective clause.
 *
 * `source` is the objective with the site spans blanked out, so a site name can
 * never become the task name. A proper-noun phrase wins; otherwise the trigger
 * verb, the leading determiners and quantifiers, a "<quantity> <noun> of" phrase
 * and the trailing time words are dropped. Returns null when nothing is left.
 */
export function deriveSubject(source: string): string | null {
  const clean = stripOrphanPunctuation(source);
  if (clean.length === 0) return null;

  let list = words(clean);
  const first = list[0];
  if (first !== undefined && TRIGGER_VERBS.includes(bareWord(first))) list = list.slice(1);
  const droppable = (word: string | undefined): boolean => {
    if (word === undefined) return false;
    const bare = bareWord(word);
    return bare.length === 0 || DETERMINERS.has(bare) || QUANTITY_WORDS.has(bare) || /^\d+$/.test(bare);
  };
  while (droppable(list[0])) list = list.slice(1);

  // §8.1 step 4: nothing dangling at either end ("for the biology exam" → "biology exam").
  list = words(stripFunctionWords(list.join(" ")));

  // A proper-noun phrase in what is left wins, before the "of" rule below, so the
  // "of" inside a name ("Treaty of Westphalia") is kept.
  const named = properNounPhrases(stripOrphanPunctuation(list.join(" ")))[0];
  if (named !== undefined) return capitaliseFirst(named);

  // "chapters of Pattern Recognition" → everything up to and including "of" goes.
  const of = list.slice(0, 4).findIndex((w) => bareWord(w) === "of");
  if (of >= 0) {
    list = list.slice(of + 1);
    while (droppable(list[0])) list = list.slice(1);
  }

  // Trailing time words and dangling joiners.
  for (;;) {
    const last = list[list.length - 1];
    if (last === undefined) break;
    const bare = bareWord(last);
    if (bare.length === 0 || TIME_WORDS.has(bare) || JOINERS.has(bare)) list = list.slice(0, -1);
    else break;
  }

  const rest = stripFunctionWords(list.join(" "));
  if (rest.length === 0) return null;
  // The "of" rule may have exposed a name ("chapters of Pattern Recognition today").
  return capitaliseFirst(properNounPhrases(rest)[0] ?? rest);
}
