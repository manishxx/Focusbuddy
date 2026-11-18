/**
 * Task label (PARSER_SPEC §8).
 *
 * Starts from the text with the duration, site, objective and mode spans removed,
 * drops the filler people put around a request, and then applies §8.1 (D-025): a
 * leftover subordinate clause is never the label, the label never equals the
 * objective, and the derived subject is used instead. The §8 chain follows: the
 * objective text, the whole cleaned sentence, the bank's default label.
 */
import { LIMITS } from "../storage/validate";
import { sameText, startsWithSubordinator, stripFunctionWords } from "./subject";
import { capitaliseFirst, collapse, stripOrphanPunctuation, toLowerAligned } from "./text";

/** PARSER_SPEC §8 leading filler. */
export const LEADING_FILLER: readonly string[] = Object.freeze([
  "i want to",
  "i need to",
  "i'd like to",
  "i am going to",
  "i'm going to",
  "my plan is to",
  "help me",
  "please",
  "today",
  "let's",
]);

/** PARSER_SPEC §8 trailing filler. */
export const TRAILING_FILLER: readonly string[] = Object.freeze([
  "and intervene when i get distracted",
  "help me stay focused",
  "please",
  "thanks",
]);

/**
 * Function words that cannot carry a task on their own. A fragment made only of
 * these (plus punctuation) is sentence glue left behind once the spans were
 * removed ("I have .", "I'll be using , , and ."), so it is dropped.
 */
export const GLUE_WORDS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "also",
  "am",
  "an",
  "and",
  "are",
  "around",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "do",
  "for",
  "from",
  "going",
  "gonna",
  "got",
  "had",
  "has",
  "have",
  "help",
  "here",
  "i",
  "i'd",
  "i'll",
  "i'm",
  "in",
  "is",
  "it",
  "its",
  "let's",
  "lets",
  "like",
  "me",
  "my",
  "need",
  "next",
  "of",
  "on",
  "or",
  "plan",
  "please",
  "so",
  "thanks",
  "that",
  "the",
  "then",
  "there",
  "this",
  "to",
  "use",
  "used",
  "using",
  "wanna",
  "want",
  "wanted",
  "we",
  "we'll",
  "will",
  "with",
  "would",
]);

function dropFiller(text: string): string {
  let out = collapse(text);
  for (let changed = true; changed;) {
    changed = false;
    const lower = toLowerAligned(out);
    for (const filler of LEADING_FILLER) {
      if (lower.startsWith(filler) && !/[\p{L}\p{N}]/u.test(lower[filler.length] ?? " ")) {
        out = collapse(out.slice(filler.length));
        changed = true;
        break;
      }
    }
    if (changed) continue;
    const bare = lower.replace(/[\s.,;:!?]+$/u, "");
    for (const filler of TRAILING_FILLER) {
      if (bare.endsWith(filler) && !/[\p{L}\p{N}]/u.test(bare[bare.length - filler.length - 1] ?? " ")) {
        out = collapse(out.slice(0, bare.length - filler.length));
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * Keeps only the fragments that say something (see GLUE_WORDS).
 *
 * Splits on a sentence separator **followed by whitespace or the end of the text**,
 * and keeps the separators it split on, so an abbreviation ("Ph.D.", "Dr. Smith")
 * survives unchanged (review F10).
 */
function dropGlueFragments(text: string): string {
  const parts = text.split(/([.;!?]+(?:\s+|$))/u);
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    const fragment = parts[i] ?? "";
    const separator = parts[i + 1] ?? "";
    const list = toLowerAligned(fragment).match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) ?? [];
    if (list.length > 0 && list.some((word) => !GLUE_WORDS.has(word))) out += fragment + separator;
  }
  return out;
}

export type LabelResult = {
  label: string;
  truncated: boolean;
  /** A fallback was used, so the form asks the user to name the task (`label_fallback`). */
  fallback: boolean;
  /** Which §8 / §8.1 step produced the label. */
  source: "leftover" | "subject" | "objective" | "sentence" | "default";
};

function cap(label: string): { label: string; truncated: boolean } {
  if (label.length <= LIMITS.taskLabel) return { label, truncated: false };
  const hard = label.slice(0, LIMITS.taskLabel);
  const lastSpace = hard.lastIndexOf(" ");
  const cut = lastSpace > LIMITS.taskLabel - 25 ? hard.slice(0, lastSpace) : hard;
  return { label: cut.trimEnd(), truncated: true };
}

/**
 * `leftover` is the text with every consumed span blanked out; `subject` is the
 * §8.1 subject of the objective (null when none could be derived); `objective` and
 * `wholeSentence` are the §8 fallbacks and `defaultLabel` the last one.
 */
export function buildLabel(
  leftover: string,
  objective: string,
  subject: string | null,
  wholeSentence: string,
  defaultLabel: string,
): LabelResult {
  const swept = stripOrphanPunctuation(dropGlueFragments(stripOrphanPunctuation(dropFiller(leftover))));
  // §8.1 steps 2 and 4: a leftover subordinate clause ("because it is due tomorrow")
  // is not the name of a task, and nothing dangles at either end ("Can I", "Actually",
  // "And then write notes" → "Write notes").
  const cleaned = startsWithSubordinator(swept) ? "" : stripFunctionWords(swept);
  const usable = cleaned.length >= 2 && !sameText(cleaned, objective);
  if (usable) return { ...cap(capitaliseFirst(cleaned)), fallback: false, source: "leftover" };
  // §8.1 step 3: the subject, never a label equal to the objective.
  if (subject !== null && subject.length >= 2 && !sameText(subject, objective)) {
    return { ...cap(subject), fallback: false, source: "subject" };
  }
  if (objective.length >= 2) {
    // No subject could be derived: keep the goal text and ask for a name (§8.1 step 3).
    return { ...cap(capitaliseFirst(objective)), fallback: true, source: "objective" };
  }
  // §8.1 steps 4 and 5: the whole-sentence fallback is swept too, so a sentence that
  // is only filler, a duration and a number ("for 9999 hours") is not a task name.
  const whole = stripFunctionWords(stripOrphanPunctuation(dropFiller(wholeSentence)));
  if (whole.length >= 2) {
    const { label } = cap(capitaliseFirst(whole));
    return { label, truncated: false, fallback: true, source: "sentence" };
  }
  return { label: defaultLabel, truncated: false, fallback: true, source: "default" };
}
