/**
 * The PARSER_SPEC §13 corpus: every fixture asserts the full draft and the exact
 * warning set, plus the AC-01 reference sentence (§12) as its own test.
 */
import { describe, expect, it } from "vitest";
import { parseIntent, WARNING_FIELDS } from "../../../src/core/parser";
import { LIMITS, validateSessionConfig } from "../../../src/core/storage/validate";
import { AC01, AC01_EXPECTATIONS, FIXTURES } from "./fixtures";
import { ctx } from "./helpers";

const run = (f: (typeof FIXTURES)[number]) =>
  parseIntent(
    f.text,
    ctx({
      ...(f.tzOffsetMin !== undefined && { tzOffsetMin: f.tzOffsetMin }),
      ...(f.defaults?.plannedMin !== undefined && { plannedMin: f.defaults.plannedMin }),
      ...(f.defaults?.mode !== undefined && { mode: f.defaults.mode }),
    }),
  );

describe("corpus (PARSER_SPEC §13)", () => {
  it("covers at least 45 sentences", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(45);
    expect(new Set(FIXTURES.map((f) => f.name)).size).toBe(FIXTURES.length);
  });

  it.each(FIXTURES.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const result = run(f);
    expect(result.draft).toEqual(f.draft);
    expect(result.warnings.map((w) => w.code)).toEqual(f.warnings);
    for (const w of result.warnings) expect(w.field).toBe(WARNING_FIELDS[w.code]);
  });

  it("every fixture draft passes the Day 06 validators", () => {
    for (const f of FIXTURES) {
      const { draft } = run(f);
      const { plannedMin, mode, ...config } = draft;
      expect(validateSessionConfig({ ...config, mode })).toMatchObject({ ok: true });
      expect(plannedMin).toBeGreaterThanOrEqual(LIMITS.plannedMinMin);
      expect(plannedMin).toBeLessThanOrEqual(LIMITS.plannedMinMax);
    }
  });

  it("is deterministic: the same text and the same now give the same output", () => {
    for (const f of FIXTURES) expect(run(f)).toEqual(run(f));
  });
});

describe("AC-01 reference sentence (PARSER_SPEC §12)", () => {
  it("meets every §12 expectation", () => {
    const { draft, warnings } = run(AC01);
    expect(draft.plannedMin).toBe(AC01_EXPECTATIONS.plannedMin);
    for (const host of AC01_EXPECTATIONS.hosts) expect(draft.allowedHosts).toContain(host);
    expect(draft.taskLabel).toContain(AC01_EXPECTATIONS.labelContains);
    expect(draft.objective).toContain(AC01_EXPECTATIONS.objectiveContains);
    expect(draft.keywords).toContain(AC01_EXPECTATIONS.keywordIncludes);
    for (const field of AC01_EXPECTATIONS.quietFields) {
      expect(warnings.filter((w) => w.field === field)).toEqual([]);
    }
    // Nothing else is warned about either.
    expect(warnings).toEqual([]);
  });
});
