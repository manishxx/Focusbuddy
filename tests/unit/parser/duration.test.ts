// Duration grammar (PARSER_SPEC §4): forms, clock targets, conflicts.
import { describe, expect, it } from "vitest";
import { clockTarget, findDuration, MS_PER_MIN, NUMBER_WORDS } from "../../../src/core/parser";
import { expandLead } from "../../../src/core/parser/duration";
import { FIXTURE_NOW, FIXTURE_TZ_OFFSET_MIN } from "./fixtures";

const dctx = { now: FIXTURE_NOW, tzOffsetMin: FIXTURE_TZ_OFFSET_MIN };
const minutes = (text: string, over: Partial<typeof dctx> = {}) => findDuration(text, { ...dctx, ...over }).minutes;
const codes = (text: string, over: Partial<typeof dctx> = {}) =>
  findDuration(text, { ...dctx, ...over }).warnings.map((w) => w.code);

describe("accepted forms (§4 table)", () => {
  it.each<[string, number]>([
    ["3 hours", 180],
    ["3h", 180],
    ["3 hrs", 180],
    ["2 hour", 120],
    ["1.5h", 90],
    ["1,5 h", 90],
    ["2.25 hours", 135],
    ["90 min", 90],
    ["90 minutes", 90],
    ["45m", 45],
    ["90mins", 90],
    ["1h30", 90],
    ["1h 30m", 90],
    ["1 hour 30 minutes", 90],
    ["2h15", 135],
    ["1 hour and 30 minutes", 90],
    ["half an hour", 30],
    ["half hour", 30],
    ["an hour", 60],
    ["one hour", 60],
    ["two hours", 120],
    ["ninety minutes", 90],
    ["a couple of hours", 120],
    ["couple of hours", 120],
    ["forty-five minutes", 45],
    ["forty five minutes", 45],
    ["fifteen minutes", 15],
    ["twelve hours", 720],
    ["for the next 2 hours", 120],
  ])("%s → %i", (text, expected) => {
    expect(minutes(`work ${text} on it`)).toBe(expected);
    expect(codes(`work ${text} on it`)).toEqual([]);
  });

  it.each<[string, number]>([
    ["an hour and a half", 90],
    ["one hour and a half", 90],
    ["2 hours and a half", 150],
    ["three hours and a half", 210],
    ["two and a half hours", 150],
    ["1 and a half hours", 90],
  ])("§4.1 compound %s → %i", (text, expected) => {
    expect(minutes(`work ${text} on it`)).toBe(expected);
    expect(codes(`work ${text} on it`)).toEqual([]);
  });

  it("§4.1: the whole compound phrase is consumed, including 'and a half' and a following 'of'", () => {
    const text = "read two and a half hours of notes";
    const r = findDuration(text, dctx);
    expect(r.spans).toHaveLength(1);
    expect(text.slice(r.spans[0]?.start, r.spans[0]?.end)).toBe("two and a half hours of");
    const essay = "write my essay for an hour and a half";
    const r2 = findDuration(essay, dctx);
    expect(essay.slice(r2.spans[0]?.start, r2.spans[0]?.end)).toBe("for an hour and a half");
  });

  it("knows the §4 number words", () => {
    expect(NUMBER_WORDS["ninety"]).toBe(90);
    expect(NUMBER_WORDS["forty-five"]).toBe(45);
    expect(Object.keys(NUMBER_WORDS)).toHaveLength(20);
  });

  it("finds nothing in a sentence with no duration", () => {
    expect(findDuration("read the kafka notes", dctx)).toEqual({ minutes: null, spans: [], warnings: [] });
  });

  it("does not read a bare number or a word that only starts with a unit", () => {
    expect(minutes("chapter 3 of the book")).toBeNull();
    expect(minutes("3 homework problems")).toBeNull();
    expect(minutes("5 minuscule edits")).toBeNull();
  });
});

describe("clock targets (§4, BR-5)", () => {
  it.each<[string, number]>([
    ["until 5pm", 420],
    ["until 5 pm", 420],
    ["until 5p.m.", 420],
    ["till 17:00", 420],
    ["until 5:30 pm", 450],
    ["by 11am", 60],
    ["until noon", 120],
    ["until midnight", 840],
  ])("%s → %i minutes from 10:00 local", (text, expected) => {
    expect(minutes(`write it ${text}`)).toBe(expected);
    expect(codes(`write it ${text}`)).toEqual([]);
  });

  it("does not roll over to tomorrow: a passed target warns instead (BR-5)", () => {
    expect(minutes("write it by 9am")).toBeNull();
    expect(codes("write it by 9am")).toEqual(["until_passed"]);
    expect(codes("write it until 10:00")).toEqual(["until_passed"]);
  });

  it("treats a bare 'until 5' as too vague, not as a time", () => {
    expect(minutes("write it until 5")).toBeNull();
    expect(codes("write it until 5")).toEqual(["duration_missing"]);
  });

  it("reads a duration after 'by', not a clock time", () => {
    expect(minutes("finish it by 2 hours from now")).toBe(120);
  });

  it("uses the injected time zone only (no local clock)", () => {
    expect(minutes("write it until 3am", { tzOffsetMin: -480 })).toBe(120);
    expect(codes("write it until 3am", { tzOffsetMin: -480 })).toEqual([]);
    expect(codes("write it until 3am")).toEqual(["until_passed"]);
  });

  it("computes the target from now + tzOffsetMin", () => {
    expect(clockTarget(dctx, 12, 0)).toBe(FIXTURE_NOW + 120 * MS_PER_MIN);
    expect(clockTarget(dctx, 24, 0)).toBe(FIXTURE_NOW + 840 * MS_PER_MIN);
    expect(clockTarget({ now: FIXTURE_NOW, tzOffsetMin: 0 }, 12, 0)).toBe(FIXTURE_NOW + 180 * MS_PER_MIN);
  });

  it("ignores an impossible clock time", () => {
    expect(minutes("write it until 99:99")).toBeNull();
    expect(minutes("until 25:00")).toBeNull();
  });
});

describe("conflicts (§4)", () => {
  it("uses the first duration and lists what it ignored", () => {
    const r = findDuration("read for 90 min, actually 3 hours", dctx);
    expect(r.minutes).toBe(90);
    expect(r.warnings).toEqual([
      { code: "duration_conflict", field: "plannedMin", data: { minutes: 90, names: ["3 hours"] } },
    ]);
  });

  it("lists at most three ignored forms and never the whole sentence", () => {
    const r = findDuration("30 min then 1 hour then 2 hours then 3 hours then 4 hours", dctx);
    expect(r.minutes).toBe(30);
    expect(r.warnings[0]?.data?.names).toHaveLength(3);
    for (const name of r.warnings[0]?.data?.names ?? []) expect(name.length).toBeLessThanOrEqual(24);
  });

  it("does not call overlapping readings of one phrase a conflict", () => {
    for (const text of ["1 hour 30 minutes", "half an hour", "2.25 hours", "a couple of hours"]) {
      expect(codes(`work ${text}`)).toEqual([]);
    }
  });

  it("a passed clock target wins over a later valued form (§11 precedence)", () => {
    expect(codes("write it by 9am, or 90 minutes")).toEqual(["until_passed"]);
  });

  it("consumes every matched span, and the words leading into it", () => {
    const r = findDuration("revise biology for the next 2 hours on it", dctx);
    expect(r.spans).toHaveLength(1);
    const span = r.spans[0];
    expect("revise biology for the next 2 hours on it".slice(span?.start, span?.end)).toBe("for the next 2 hours");
  });

  it("expandLead stops after three words and leaves real words alone", () => {
    expect(expandLead("revise for the next 2 hours", { start: 20, end: 27 })).toEqual({ start: 7, end: 27 });
    expect(expandLead("biology 2 hours", { start: 8, end: 15 })).toEqual({ start: 8, end: 15 });
  });
});
