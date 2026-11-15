import { describe, expect, it } from "vitest";
import {
  ELLIPSIS,
  PLACEHOLDER_LIMITS,
  format,
  hasMessage,
  stripBidiControls,
  truncate,
  variantCount,
  type MessageKey,
} from "../../src/core/messages";
import bank from "../../src/core/messages/messages.json";

const long = (n: number) => "x".repeat(n);

describe("truncate", () => {
  it("leaves text at or under the limit unchanged", () => {
    expect(truncate("abc", 3)).toBe("abc");
    expect(truncate("", 3)).toBe("");
  });
  it("cuts to limit code points including the ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc" + ELLIPSIS);
    expect(Array.from(truncate(long(100), 40))).toHaveLength(40);
  });
  it("does not split surrogate pairs", () => {
    const emoji = "😀".repeat(10);
    expect(truncate(emoji, 5)).toBe("😀😀😀😀" + ELLIPSIS);
  });
  it("counts grapheme clusters, not code points", () => {
    const family = "👨‍👩‍👧"; // 5 code points, 1 grapheme
    expect(truncate(family.repeat(3), 3)).toBe(family.repeat(3));
    expect(truncate(family.repeat(10), 5)).toBe(family.repeat(4) + ELLIPSIS);
    const accented = "e\u0301"; // e + combining acute
    expect(truncate(accented.repeat(6), 4)).toBe(accented.repeat(3) + ELLIPSIS);
    const flag = "🇳🇱";
    expect(truncate(flag.repeat(5), 2)).toBe(flag + ELLIPSIS);
  });
  it("handles a limit of zero or one", () => {
    expect(truncate("abc", 1)).toBe(ELLIPSIS);
    expect(truncate("abc", 0)).toBe(ELLIPSIS);
  });
});

describe("format", () => {
  it("returns plain strings unchanged", () => {
    expect(format("tooltip.none")).toBe("Focus Buddy: no session. Click to open.");
  });

  it("fills placeholders", () => {
    expect(format("break.started", { time: "3:40 pm" })).toBe("Break started. Back at 3:40 pm.");
    expect(format("extend.done", { minutes: 5, timeLeft: "20 min" })).toBe("Added 5 min. 20 min left.");
  });

  it.each(Object.entries(PLACEHOLDER_LIMITS))("truncates {%s} to %i characters", (name, limit) => {
    const key = (
      {
        task: "overlay.title",
        objective: "summary.objective",
        nextStep: "recovery.nextStep",
        lastTitle: "recovery.lastTitle",
        words: "relevant.confirm",
      } as const
    )[name as "task"];
    const vars = { task: "T", objective: "O", nextStep: "N", lastTitle: "L", words: "W", host: "h.example" };
    const out = format(key, { ...vars, [name]: long(limit + 25) });
    expect(out).toContain(long(limit - 1) + ELLIPSIS);
    expect(out).not.toContain(long(limit));
    const exact = format(key, { ...vars, [name]: long(limit) });
    expect(exact).toContain(long(limit));
    expect(exact).not.toContain(ELLIPSIS);
  });

  it("does not truncate other placeholders", () => {
    expect(format("relevant.confirmHost", { host: long(100), task: "T" })).toContain(long(100));
  });

  it("strips bidi controls from placeholder values", () => {
    const controls = [
      "\u202A",
      "\u202B",
      "\u202C",
      "\u202D",
      "\u202E",
      "\u2066",
      "\u2067",
      "\u2068",
      "\u2069",
      "\u200E",
      "\u200F",
    ];
    for (const c of controls) {
      expect(stripBidiControls(`a${c}b`)).toBe("ab");
      expect(format("overlay.title", { task: `${c}Essay${c}` })).toBe("Back to Essay?");
    }
    expect(format("relevant.confirmHost", { host: "\u202Eevil.example", task: "T" })).toBe(
      "Done. evil.example now counts as part of T.",
    );
    // Stripped before truncation, so controls don't use up the limit.
    const out = format("overlay.title", { task: "\u202E".repeat(50) + "x".repeat(40) });
    expect(out).toBe(`Back to ${"x".repeat(40)}?`);
  });

  it("keeps ordinary non-Latin text and ZWJ sequences", () => {
    expect(stripBidiControls("مرحبا 👨‍👩‍👧 שלום")).toBe("مرحبا 👨‍👩‍👧 שלום");
  });

  it("does not re-expand placeholders inside values", () => {
    expect(format("overlay.title", { task: "{time}" })).toBe("Back to {time}?");
  });

  it("picks array variants and rejects out-of-range ones", () => {
    const variants = bank.messages["nudge.l1"];
    expect(variantCount("nudge.l1")).toBe(variants.length);
    expect(variantCount("tooltip.none")).toBe(1);
    expect(format("nudge.l1", { task: "Essay" }, 1)).toBe(variants[1]?.replace("{task}", "Essay"));
    expect(() => format("nudge.l1", { task: "Essay" }, variants.length)).toThrow(RangeError);
    expect(() => format("nudge.l1", { task: "Essay" }, 0.5)).toThrow(RangeError);
    expect(() => format("tooltip.none", {}, 1)).toThrow(RangeError);
  });

  it("throws on an unknown key", () => {
    expect(hasMessage("no.such.key")).toBe(false);
    expect(hasMessage("toString")).toBe(false);
    expect(() => format("no.such.key" as MessageKey)).toThrow(/Unknown message key/);
    expect(() => format("toString" as MessageKey)).toThrow(/Unknown message key/);
  });

  it("throws on a missing variable", () => {
    expect(() => format("overlay.title")).toThrow(/needs a value for \{task\}/);
    expect(() => format("extend.done", { minutes: 5 })).toThrow(/\{timeLeft\}/);
  });

  it("can format every bank string when all variables are supplied", () => {
    const all = new Proxy<Record<string, string>>(
      {},
      {
        get: () => "v",
        has: () => true,
        getOwnPropertyDescriptor: () => ({ value: "v", enumerable: true, configurable: true }),
      },
    );
    for (const key of Object.keys(bank.messages) as MessageKey[]) {
      for (let i = 0; i < variantCount(key); i++) expect(format(key, all, i)).not.toMatch(/\{[A-Za-z]+\}/);
    }
  });
});
