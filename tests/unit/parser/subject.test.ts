// Subject derivation and the shared word classes (PARSER_SPEC §8.1, §9.1, D-025).
import { describe, expect, it } from "vitest";
import { parseIntent } from "../../../src/core/parser";
import {
  DETERMINERS,
  QUANTITY_WORDS,
  SUBORDINATORS,
  TIME_WORDS,
  deriveSubject,
  isAllFunctionWords,
  isNumericToken,
  properNounPhrases,
  stripFunctionWords,
  sameText,
  startsWithSubordinator,
} from "../../../src/core/parser/subject";
import { LIMITS } from "../../../src/core/storage/validate";
import { ctx } from "./helpers";

describe("deriveSubject (§8.1 step 1)", () => {
  it.each<[string, string | null]>([
    ["finish the first four chapters of Pattern Recognition today", "Pattern Recognition"],
    ["Finish the lab report", "Lab report"],
    ["Revise chemistry", "Chemistry"],
    ["Write my essay", "Essay"],
    ["Read the paper", "Paper"],
    ["Solve problem sets", "Problem sets"],
    ["read all of the Kafka notes", "Kafka notes"],
    ["revise some of my biology notes tonight", "Biology notes"],
    ["write the Treaty of Westphalia essay", "Treaty of Westphalia"],
    ["study", null],
    ["Read", null],
    ["", null],
    ["   ,  ", null],
  ])("%s → %s", (objective, expected) => {
    expect(deriveSubject(objective)).toBe(expected);
  });

  it("drops a quantifier phrase ending in 'of' when no name follows (§8.1 step 1)", () => {
    expect(deriveSubject("read all of the enzyme diagrams")).toBe("Enzyme diagrams");
    expect(deriveSubject("finish two of the exercises")).toBe("Exercises");
  });

  it("isAllFunctionWords and isNumericToken classify the §8.1 step 4 and 5 leftovers", () => {
    for (const text of ["Can I", "and then", "for 9999 hours", "the", "", "  ,  ", "1e9"]) {
      expect(isAllFunctionWords(text), text).toBe(true);
    }
    for (const text of ["chemistry", "Can I study maths"]) expect(isAllFunctionWords(text), text).toBe(false);
    for (const token of ["1", "1,5", "17:00", "1e9", "2.25"]) expect(isNumericToken(token), token).toBe(true);
    for (const token of ["1h30", "5pm", "chemistry"]) expect(isNumericToken(token), token).toBe(false);
    expect(stripFunctionWords("and then write notes")).toBe("write notes");
    expect(stripFunctionWords("for 9999 hours")).toBe("");
  });

  it("drops trailing time words and dangling joiners", () => {
    expect(deriveSubject("Finish the lab report tomorrow")).toBe("Lab report");
    expect(deriveSubject("Revise biology on")).toBe("Biology");
    expect(deriveSubject("Study algebra on and")).toBe("Algebra");
  });

  it("is not the site name, because the site spans are blanked first (§8.1)", () => {
    const { draft } = parseIntent("Study algebra on Khan Academy for 1 hour", ctx());
    expect(draft.taskLabel).toBe("Algebra");
    expect(draft.objective).toBe("Study algebra on Khan Academy");
  });

  it("never exceeds the label cap once the label step has capped it", () => {
    const long = `Finish the ${"appendix tables ".repeat(30)}`;
    const subject = deriveSubject(long) ?? "";
    expect(subject.length).toBeGreaterThan(0);
    const { draft, warnings } = parseIntent(`${long} for 1 hour`, ctx());
    expect(draft.taskLabel.length).toBeLessThanOrEqual(LIMITS.taskLabel);
    expect(warnings.map((w) => w.code)).toContain("label_truncated");
  });
});

describe("proper-noun phrases (§8.1, §9.1)", () => {
  it("takes runs of two to four capitalised words", () => {
    expect(properNounPhrases("about Pattern Recognition today")).toEqual(["Pattern Recognition"]);
    expect(properNounPhrases("Google Scholar and Google Docs")).toEqual(["Google Scholar", "Google Docs"]);
    expect(properNounPhrases("the Treaty of Westphalia")).toEqual(["Treaty of Westphalia"]);
    // M11: two words is the lower bound, four the upper.
    expect(properNounPhrases("one Word")).toEqual([]);
    expect(properNounPhrases("Word")).toEqual([]);
    expect(properNounPhrases("Two Words")).toEqual(["Two Words"]);
    expect(properNounPhrases("One Two Three Four")).toEqual(["One Two Three Four"]);
    // A longer run contributes its first four words (the regex matches left to right).
    expect(properNounPhrases("One Two Three Four Five")).toEqual(["One Two Three Four"]);
    expect(properNounPhrases("A B C D E")).toEqual([]);
  });

  it("ignores a capitalised sentence opening that starts with a trigger verb", () => {
    expect(properNounPhrases("Read the Kafka notes")).toEqual([]);
    expect(properNounPhrases("Revise French")).toEqual([]);
    expect(properNounPhrases("Study Zork")).toEqual([]);
  });
});

describe("word classes", () => {
  it("startsWithSubordinator spots a leftover clause", () => {
    for (const word of [...SUBORDINATORS]) expect(startsWithSubordinator(`${word} something happened`)).toBe(true);
    expect(startsWithSubordinator("chemistry revision")).toBe(false);
    expect(startsWithSubordinator("")).toBe(false);
  });

  it("sameText ignores case and punctuation", () => {
    expect(sameText("Finish the lab report", "finish the lab report.")).toBe(true);
    expect(sameText("Lab report", "Finish the lab report")).toBe(false);
    expect(sameText("", "")).toBe(false);
    expect(sameText(" , ", "x")).toBe(false);
  });

  it("holds the §8.1 and §9.1 word lists", () => {
    for (const word of ["the", "my", "some", "all"]) expect(DETERMINERS.has(word)).toBe(true);
    for (const word of ["first", "four", "half", "couple", "next"]) expect(QUANTITY_WORDS.has(word)).toBe(true);
    for (const word of ["today", "tomorrow", "due", "deadline", "week"]) expect(TIME_WORDS.has(word)).toBe(true);
  });
});
