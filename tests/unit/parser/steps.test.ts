// Objective (§6), task label (§8), keywords (§9) and the text helpers (§2).
import { describe, expect, it } from "vitest";
import {
  buildKeywords,
  isWeakKeyword,
  isWeakPhrase,
  properNounPhrases,
  truncatePhrase,
  FUNCTION_WORDS,
  buildLabel,
  findObjective,
  KEYWORDS_MAX,
  LEADING_FILLER,
  STOP_WORDS,
  subjectPhrase,
  TRAILING_FILLER,
  TRIGGER_VERBS,
} from "../../../src/core/parser";
import {
  blank,
  capitaliseFirst,
  collapse,
  findWords,
  normalise,
  stripOrphanPunctuation,
} from "../../../src/core/parser/text";
import { LIMITS } from "../../../src/core/storage/validate";

const objectiveOf = (text: string) => {
  const { text: clean, lower } = normalise(text);
  return findObjective(clean, lower, []);
};

describe("normalise (§2)", () => {
  it("applies NFC, strips format characters and collapses whitespace", () => {
    expect(normalise("étude  \t x").text).toBe("étude x");
    expect(normalise("a​b‮c").text).toBe("abc");
    expect(normalise("line one\nline two").text).toBe("line one line two");
    expect(normalise("  padded  ").text).toBe("padded");
  });

  it("keeps the lowercase copy index-aligned with the original", () => {
    const { text, lower } = normalise("İstanbul YOUTUBE");
    expect(lower).toHaveLength(text.length);
    expect(lower.endsWith("youtube")).toBe(true);
  });

  it("maps a curly apostrophe so filler and boundaries still match", () => {
    expect(normalise("I’ll use it").lower).toBe("i'll use it");
  });

  it("blank() replaces spans with spaces and keeps the length", () => {
    expect(blank("abcdef", [{ start: 1, end: 3 }])).toBe("a  def");
    expect(blank("abc", [])).toBe("abc");
  });

  it("findWords only matches whole words", () => {
    expect(findWords("a cat scattered cats", "cat")).toEqual([{ start: 2, end: 5 }]);
    expect(findWords("anything", "")).toEqual([]);
  });

  it("strips orphan punctuation and capitalises", () => {
    expect(stripOrphanPunctuation("  , ; study  , , chemistry . ")).toBe("study chemistry");
    expect(stripOrphanPunctuation("study, chemistry.")).toBe("study, chemistry");
    expect(capitaliseFirst("study")).toBe("Study");
    expect(capitaliseFirst("")).toBe("");
    expect(capitaliseFirst("étude")).toBe("Étude");
    expect(collapse(" a  b ")).toBe("a b");
  });
});

describe("objective (§6)", () => {
  it("takes the clause from the trigger verb and keeps the casing", () => {
    expect(objectiveOf("I want to Finish the lab report today").objective).toBe("Finish the lab report today");
  });

  it.each(TRIGGER_VERBS)("recognises the trigger verb %s", (verb) => {
    expect(objectiveOf(`please ${verb} the notes`).objective.toLowerCase()).toBe(`${verb} the notes`);
  });

  it.each([
    ["Finish the report. Then rest", "Finish the report"],
    ["Finish the report; then rest", "Finish the report"],
    ["Finish the report, then rest", "Finish the report"],
    ["Finish the report and then rest", "Finish the report"],
    ["Finish the report then rest", "Finish the report"],
    ["Finish the report so that I can rest", "Finish the report"],
    ["Finish the report because it is due", "Finish the report"],
    ["Finish the report. I have 2 hours", "Finish the report"],
    ["Finish the report using Zotero", "Finish the report"],
    ["Finish the report help me stay focused", "Finish the report"],
  ])("cuts %s at the clause boundary", (text, expected) => {
    expect(objectiveOf(text).objective).toBe(expected);
  });

  it("does not cut inside a domain or a decimal", () => {
    expect(objectiveOf("Read docs.example.com and chapter 1.5").objective).toBe(
      "Read docs.example.com and chapter 1.5",
    );
  });

  it("is empty when no trigger verb appears", () => {
    expect(objectiveOf("Spanish flashcards")).toEqual({ objective: "", span: null, truncated: false });
  });

  it("caps at the validator limit and reports the cut", () => {
    const long = `Finish ${"the appendix tables ".repeat(30)}`;
    const found = objectiveOf(long);
    expect(found.truncated).toBe(true);
    expect(found.objective.length).toBeLessThanOrEqual(LIMITS.objective);
  });

  it("drops the joiner a removed duration left behind", () => {
    const { text, lower } = normalise("study for 2 hours");
    // "for 2 hours" blanked out, as the pipeline does.
    const blanked = blank(lower, [{ start: 6, end: 17 }]);
    expect(findObjective(blank(text, [{ start: 6, end: 17 }]), blanked, []).objective).toBe("study");
  });

  it("ignores a verb inside a span another step took", () => {
    const { text, lower } = normalise("read the notes");
    expect(findObjective(text, lower, [{ start: 0, end: 4 }]).objective).toBe("");
  });
});

describe("task label (§8, §8.1)", () => {
  const label = (leftover: string, objective = "", subject: string | null = null, whole = "whole sentence") =>
    buildLabel(leftover, objective, subject, whole, "Focus session");

  it("drops leading and trailing filler", () => {
    expect(label("I want to revise chemistry").label).toBe("Revise chemistry");
    expect(label("Please revise chemistry, thanks").label).toBe("Revise chemistry");
    expect(label("Revise chemistry. Help me stay focused and intervene when I get distracted.").label).toBe(
      "Revise chemistry",
    );
    for (const filler of [...LEADING_FILLER, ...TRAILING_FILLER]) expect(filler).toBe(filler.toLowerCase());
  });

  it("capitalises the first letter and strips orphan punctuation", () => {
    expect(label("  ,  revise chemistry  , ").label).toBe("Revise chemistry");
  });

  it("uses the derived subject rather than the goal clause (§8.1 step 3)", () => {
    expect(label("  ,  ", "Finish the lab report", "Lab report")).toEqual({
      label: "Lab report",
      truncated: false,
      fallback: false,
      source: "subject",
    });
  });

  it("never uses a leftover subordinate clause as the label (§8.1 step 2)", () => {
    for (const clause of [
      "because it is due tomorrow",
      "since the deadline moved",
      "so that I can rest",
      "although it is late",
      "due tomorrow",
    ]) {
      expect(label(clause, "Finish the lab report", "Lab report")).toMatchObject({
        label: "Lab report",
        source: "subject",
      });
    }
  });

  it("never returns a label equal to the objective, unless there is nothing else (§8.1 step 3)", () => {
    // The subject is the objective itself: unusable, so the goal text is kept and warned about.
    expect(label("  ", "Study", "Study")).toEqual({
      label: "Study",
      truncated: false,
      fallback: true,
      source: "objective",
    });
    expect(label("Finish the lab report", "Finish the lab report", null)).toMatchObject({
      label: "Finish the lab report",
      fallback: true,
      source: "objective",
    });
  });

  it("falls back to the whole sentence, then to the default label, with a warning", () => {
    expect(label("  ", "", null, "1h30 of leetcode")).toMatchObject({
      label: "1h30 of leetcode",
      fallback: true,
      source: "sentence",
    });
    expect(label("", "", null, "")).toMatchObject({ label: "Focus session", fallback: true, source: "default" });
    expect(label("", "", null, "\u{1F642}")).toMatchObject({ label: "Focus session", source: "default" });
  });

  it("drops fragments that are only sentence glue", () => {
    expect(label("I have . I'll be using , , and .", "Finish the chapters", "Chapters").label).toBe("Chapters");
  });

  it("keeps a fragment that says something, without the dangling words (§8.1 step 4)", () => {
    expect(label("I have a lab report on enzymes").label).toBe("Lab report on enzymes");
    expect(label("Can I study maths").label).toBe("Study maths");
    expect(label("And then write notes").label).toBe("Write notes");
  });

  it("never returns a label made only of function words, numbers or time words", () => {
    for (const leftover of ["Can I", "Actually", "For 9999 hours", "then", "and", "the"]) {
      expect(label(leftover, "", null, "").label, leftover).toBe("Focus session");
    }
    // A content word survives; only what dangles around it goes.
    expect(label("Check then").label).toBe("Check");
    expect(label("For chemistry").label).toBe("Chemistry");
  });

  it("caps at the validator limit on a word boundary", () => {
    const { label: cut, truncated } = label(`Revise ${"chemistry ".repeat(30)}`);
    expect(truncated).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(LIMITS.taskLabel);
    expect(cut.endsWith("chemistry")).toBe(true);
  });

  it("caps a label with no spaces at the hard limit", () => {
    const { label: cut, truncated } = label("x".repeat(200));
    expect(truncated).toBe(true);
    expect(cut).toHaveLength(LIMITS.taskLabel);
  });
});

describe("keywords (§9, §9.1)", () => {
  it("keeps the user's words, dropping stop, time, quantity and filler words", () => {
    expect(
      buildKeywords(
        "Pattern Recognition",
        "finish the first four chapters of Pattern Recognition today",
        "Pattern Recognition",
      ).keywords,
    ).toEqual(["pattern recognition", "pattern", "recognition"]);
    for (const weak of ["today", "tomorrow", "due", "deadline", "half", "first", "next", "couple", "four"]) {
      expect(isWeakKeyword(weak), weak).toBe(true);
    }
    expect(isWeakKeyword("chemistry")).toBe(false);
    expect(STOP_WORDS.has("chapters")).toBe(true);
    expect(STOP_WORDS.has("page")).toBe(true);
    for (const verb of TRIGGER_VERBS) expect(STOP_WORDS.has(verb)).toBe(true);
  });

  it("adds a phrase only from a proper-noun phrase or the derived subject (§9.1)", () => {
    expect(buildKeywords("Organic chemistry", "revise organic chemistry", "Organic chemistry").keywords).toContain(
      "organic chemistry",
    );
    // No subject: no phrase keyword from arbitrary leftover text.
    expect(buildKeywords("Revise organic chemistry", "").keywords).toEqual(["organic", "chemistry"]);
    // A proper-noun phrase in the goal counts, up to four words.
    expect(buildKeywords("Essay", "write the Treaty of Westphalia essay", "Essay").keywords).toContain(
      "treaty of westphalia",
    );
    expect(subjectPhrase("Revise the organic chemistry notes")).toBe("organic chemistry notes");
  });

  it("rejects a phrase whose first or last token is weak (§9.2, review F3)", () => {
    for (const phrase of [
      "for the biology exam",
      "in strict mode",
      "and write",
      "chapter 5 page 9",
      "how to code",
      "guitar every",
      "the news",
      "dr. smith's ph.d",
    ]) {
      expect(isWeakPhrase(phrase), phrase).toBe(true);
    }
    for (const phrase of ["pattern recognition", "biology exam", "treaty of westphalia", "lab report"]) {
      expect(isWeakPhrase(phrase), phrase).toBe(false);
    }
  });

  it("truncates a phrase at an interior preposition or conjunction (§9.0, D-027)", () => {
    expect(truncatePhrase("problem set for calculus")).toBe("problem set");
    expect(truncatePhrase("lab report for physics")).toBe("lab report");
    expect(truncatePhrase("wiki articles about x")).toBe("wiki articles");
    expect(truncatePhrase("revision and homework")).toBe("revision");
    // of and the are kept, so a proper name survives.
    expect(truncatePhrase("treaty of westphalia")).toBe("treaty of westphalia");
    expect(truncatePhrase("battle of the somme")).toBe("battle of the somme");
    expect(truncatePhrase("pattern recognition")).toBe("pattern recognition");
    // A breaker in first position is not interior: the phrase check rejects it instead.
    expect(truncatePhrase("for the biology exam")).toBe("for the biology exam");
  });

  it("keeps a phrase whose first token is generic, rejects one ending generic (§9.0, D-027)", () => {
    expect(isWeakPhrase("web development")).toBe(false);
    expect(isWeakPhrase("news coverage")).toBe(false);
    expect(isWeakPhrase("home page")).toBe(true);
    expect(isWeakPhrase("web work")).toBe(true);
    expect(buildKeywords("Web development", "study web development", "Web development").keywords).toContain(
      "web development",
    );
  });

  it("M11: a one-word capitalised run is never a phrase keyword (§9.1(a) lower bound)", () => {
    expect(buildKeywords("Chemistry", "revise Chemistry", "Chemistry").keywords).toEqual(["chemistry"]);
    expect(isWeakPhrase("chemistry")).toBe(true);
    expect(properNounPhrases("revise Chemistry")).toEqual([]);
    for (const phrase of buildKeywords("Pattern Recognition", "finish Pattern Recognition", "Pattern Recognition")
      .keywords) {
      expect(["pattern recognition", "pattern", "recognition"]).toContain(phrase);
    }
  });

  it("treats contractions and stray adverbs as function words, never keywords (§9.0, D-027)", () => {
    for (const word of [
      "don",
      "don't",
      "can't",
      "won't",
      "isn't",
      "doesn't",
      "didn't",
      "couldn't",
      "shouldn't",
      "wouldn't",
      "just",
      "already",
      "really",
      "actually",
      "thanks",
      "please",
      "nt",
    ]) {
      expect(isWeakKeyword(word), word).toBe(true);
      expect(FUNCTION_WORDS.has(word), word).toBe(true);
    }
  });

  it("blocks generic web and filler single words (§9.2, review F4)", () => {
    for (const word of [
      "com",
      "www",
      "http",
      "page",
      "home",
      "site",
      "website",
      "web",
      "online",
      "news",
      "video",
      "videos",
      "work",
      "thing",
      "things",
      "stuff",
      "focus",
      "why",
      "how",
      "what",
      "5pm",
      "17:00",
      "1e9",
      "1h30",
    ]) {
      expect(isWeakKeyword(word), word).toBe(true);
    }
    for (const word of ["chemistry", "enzymes", "recognition", "thesis", "guitar"]) {
      expect(isWeakKeyword(word), word).toBe(false);
    }
  });

  it("never takes a keyword from a dropped filler phrase or a discarded clause (§9.1)", () => {
    const { keywords } = buildKeywords("Lab report", "Finish the lab report", "Lab report");
    expect(keywords).toEqual(["lab report", "lab", "report"]);
    for (const dropped of ["due", "tomorrow", "please", "thanks", "help"]) expect(keywords).not.toContain(dropped);
  });

  it("de-duplicates and preserves order", () => {
    expect(buildKeywords("Notes", "notes and NOTES").keywords).toEqual(["notes"]);
  });

  it("caps at 12 with a warning flag", () => {
    const many = Array.from({ length: 20 }, (_, i) => `word${i}aa`).join(" ");
    const found = buildKeywords(many, "");
    expect(found.keywords).toHaveLength(KEYWORDS_MAX);
    expect(found.truncated).toBe(true);
  });

  it("never emits a keyword longer than the validator allows", () => {
    const found = buildKeywords(`Revise ${"x".repeat(200)}`, "");
    for (const keyword of found.keywords) {
      expect(keyword.length).toBeGreaterThanOrEqual(1);
      expect(keyword.length).toBeLessThanOrEqual(LIMITS.keywordLength);
    }
  });

  it("returns nothing for an empty label and objective", () => {
    expect(buildKeywords("", "")).toEqual({ keywords: [], truncated: false, found: 0 });
  });
});
