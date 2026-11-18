/**
 * Property-style tests: whatever the input, the parser returns a draft the real
 * validators accept, with plannedMin in range, at most one warning per field and no
 * warning data carrying the sentence. Seeded PRNG, so a failure is reproducible.
 */
import { describe, expect, it } from "vitest";
import { parseIntent, TEXT_MAX } from "../../../src/core/parser";
import { LIMITS, validateSessionConfig } from "../../../src/core/storage/validate";
import { FIXTURES } from "./fixtures";
import { ctx } from "./helpers";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fragments taken from the corpus, plus the pieces the grammar reacts to. */
const FRAGMENTS: readonly string[] = [
  ...FIXTURES.flatMap((f) => f.text.split(/[.,;]/).map((s) => s.trim())).filter((s) => s.length > 0 && s.length < 60),
  "until 5",
  "until 5pm",
  "by 9am",
  "1h30",
  "half an hour",
  "90 min",
  "12 hours",
  "2 minutes",
  "youtube",
  "google scholar",
  "gmail",
  "docs.example.com/x",
  "münchen.de",
  "__proto__",
  "<script>",
  "{{task}}",
  "‮reversed‬",
  "\u0000\u0007",
  "strict mode",
  "finish the chapters",
  "",
  "   ",
  "\u{1F642}",
];

function randomUnicode(rnd: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const pick = rnd();
    const code =
      pick < 0.4
        ? 0x20 + Math.floor(rnd() * 0x5f) // ASCII
        : pick < 0.6
          ? Math.floor(rnd() * 0x20) // control characters
          : pick < 0.8
            ? 0x80 + Math.floor(rnd() * 0x2f00) // Latin, Greek, Cyrillic, CJK punctuation
            : 0x1f300 + Math.floor(rnd() * 0x400); // emoji
    out += String.fromCodePoint(code);
  }
  return out;
}

function randomText(rnd: () => number): string {
  const kind = rnd();
  if (kind < 0.4) {
    const parts = 1 + Math.floor(rnd() * 12);
    const joiners = [" ", ", ", ". ", " and ", "; ", "\n"];
    let out = "";
    for (let i = 0; i < parts; i++) {
      out += FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)] ?? "";
      out += joiners[Math.floor(rnd() * joiners.length)] ?? " ";
    }
    return out;
  }
  if (kind < 0.7) return randomUnicode(rnd, 1 + Math.floor(rnd() * 120));
  if (kind < 0.85) return randomUnicode(rnd, TEXT_MAX);
  return (FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)] ?? "x").repeat(1 + Math.floor(rnd() * 80));
}

function check(text: string, now: number, tzOffsetMin: number, seed: number): void {
  const { draft, warnings } = parseIntent(text, ctx({ now, tzOffsetMin }));
  const { plannedMin, mode, ...config } = draft;
  const result = validateSessionConfig({ ...config, mode });
  expect(result.ok, `seed ${seed}: ${JSON.stringify(result)} for ${JSON.stringify(text.slice(0, 80))}`).toBe(true);
  expect(plannedMin, `seed ${seed}`).toBeGreaterThanOrEqual(LIMITS.plannedMinMin);
  expect(plannedMin, `seed ${seed}`).toBeLessThanOrEqual(LIMITS.plannedMinMax);
  expect(Number.isInteger(plannedMin), `seed ${seed}`).toBe(true);

  const fields = warnings.map((w) => w.field);
  expect(new Set(fields).size, `seed ${seed}: ${fields.join()}`).toBe(fields.length);

  const normalised = text.trim();
  for (const w of warnings) {
    for (const value of [w.data?.value ?? "", ...(w.data?.names ?? [])]) {
      expect(value.length, `seed ${seed}`).toBeLessThanOrEqual(24);
      if (normalised.length > 24) expect(value).not.toBe(normalised);
    }
    expect(w.data?.minutes === undefined || Number.isFinite(w.data.minutes)).toBe(true);
  }
}

describe("properties over random input", () => {
  it("holds for 600 random sentences", () => {
    for (let seed = 1; seed <= 600; seed++) {
      const rnd = mulberry32(seed);
      const now = Math.floor(rnd() * 2_000_000_000_000);
      const tz = [-720, -480, -270, 0, 60, 330, 840][Math.floor(rnd() * 7)] ?? 0;
      check(randomText(rnd), now, tz, seed);
    }
  });

  it("holds for every fixture text at random times and time zones", () => {
    const rnd = mulberry32(99);
    for (const f of FIXTURES) {
      for (let i = 0; i < 3; i++) {
        check(f.text, Math.floor(rnd() * 2_000_000_000_000), Math.floor(rnd() * 1681) - 840, 99);
      }
    }
  });

  it("is deterministic for the same text, now and time zone", () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const text = randomText(rnd);
      const now = Math.floor(rnd() * 2_000_000_000_000);
      const context = ctx({ now, tzOffsetMin: 60 });
      expect(parseIntent(text, context)).toEqual(parseIntent(text, context));
    }
  });
});
