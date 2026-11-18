// The §3 pipeline, the §10 clamps and the §11 warning precedence.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANNED_MIN,
  parseIntent,
  pickWarnings,
  SITES,
  TEXT_MAX,
  WARNING_CODES,
  WARNING_FIELDS,
  WARNING_MESSAGE_KEYS,
  warning,
  type ParseWarning,
  type WarningCode,
} from "../../../src/core/parser";
import { hasMessage } from "../../../src/core/messages";
import bank from "../../../src/core/messages/messages.json";
import { LIMITS } from "../../../src/core/storage/validate";
import { ctx } from "./helpers";

const codes = (text: string, over = {}) => parseIntent(text, ctx(over)).warnings.map((w) => w.code);

describe("warning codes and message keys (§11)", () => {
  it("every warning code has a key in the message bank", () => {
    for (const code of WARNING_CODES) {
      const key = WARNING_MESSAGE_KEYS[code];
      expect(hasMessage(key), `${code} → ${key}`).toBe(true);
      expect(Object.keys(bank.messages)).toContain(key);
    }
  });

  it("maps every code to exactly one field, and covers both tables", () => {
    expect(Object.keys(WARNING_FIELDS).sort()).toEqual([...WARNING_CODES].sort());
    expect(Object.keys(WARNING_MESSAGE_KEYS).sort()).toEqual([...WARNING_CODES].sort());
    expect(new Set(Object.values(WARNING_FIELDS))).toEqual(
      new Set(["plannedMin", "allowedHosts", "objective", "taskLabel", "keywords"]),
    );
  });

  it("the default label comes from the bank, not from code", () => {
    expect(bank.messages["parse.defaultLabel"]).toBe("Focus session");
    expect(parseIntent("", ctx()).draft.taskLabel).toBe("Focus session");
  });
});

describe("one warning per field, by §11 precedence", () => {
  it("keeps the earliest code per field", () => {
    const found: ParseWarning[] = [
      warning("duration_defaulted"),
      warning("until_passed"),
      warning("label_fallback"),
      warning("label_truncated"),
      warning("sites_truncated"),
      warning("site_sensitive_skipped"),
    ];
    expect(pickWarnings(found).map((w) => w.code)).toEqual([
      "until_passed",
      "site_sensitive_skipped",
      "label_truncated",
    ]);
  });

  it("holds for every pair of codes in a field", () => {
    for (const a of WARNING_CODES) {
      for (const b of WARNING_CODES) {
        const picked = pickWarnings([warning(a), warning(b)]);
        const fields = picked.map((w) => w.field);
        expect(new Set(fields).size).toBe(fields.length);
      }
    }
  });

  it("never returns two warnings for one field from a real sentence", () => {
    for (const text of [
      "write it by 9am or in 90 minutes",
      `${"x".repeat(400)} for 1 hour`,
      "check gmail and münchen.de for 1 hour",
    ]) {
      const fields = parseIntent(text, ctx()).warnings.map((w) => w.field);
      expect(new Set(fields).size).toBe(fields.length);
    }
  });
});

describe("clamps (§10, BR-5)", () => {
  it("clamps below 5 and above 480 minutes", () => {
    expect(parseIntent("review it for 2 minutes", ctx()).draft.plannedMin).toBe(LIMITS.plannedMinMin);
    expect(codes("review it for 2 minutes")).toEqual(["duration_clamped_min"]);
    expect(parseIntent("review it for 12 hours", ctx()).draft.plannedMin).toBe(LIMITS.plannedMinMax);
    expect(codes("review it for 12 hours")).toEqual(["duration_clamped_max"]);
  });

  it("uses the injected default when nothing is found, without a clamp warning", () => {
    expect(parseIntent("kafka notes", ctx({ plannedMin: 45 })).draft.plannedMin).toBe(45);
    expect(codes("kafka notes", { plannedMin: 45 })).toEqual(["duration_defaulted", "objective_missing"]);
    // An out-of-range default is still clamped, quietly: it is not the user's number.
    expect(parseIntent("kafka notes", ctx({ plannedMin: 9999 })).draft.plannedMin).toBe(LIMITS.plannedMinMax);
    expect(codes("kafka notes", { plannedMin: 9999 })).toEqual(["duration_defaulted", "objective_missing"]);
    expect(parseIntent("kafka notes", ctx({ plannedMin: Number.NaN })).draft.plannedMin).toBe(LIMITS.plannedMinMin);
  });

  it("the default planned length matches the bank's wording", () => {
    expect(DEFAULT_PLANNED_MIN).toBe(60);
    expect(bank.messages["parse.durationDefaulted"]).toContain("60 minutes");
  });
});

describe("mode (§7, D-025)", () => {
  it.each<[string, string]>([
    ["study chemistry, strict mode", "strict"],
    ["be strict. study chemistry", "strict"],
    ["gentle mode: study chemistry", "gentle"],
    ["adaptive mode. study chemistry", "adaptive"],
    ["be adaptive. study chemistry", "adaptive"],
  ])("%s → %s", (text, mode) => {
    expect(parseIntent(text, ctx({ mode: "gentle" })).draft.mode).toBe(mode);
  });

  it("a bare mode word in ordinary prose is not a mode (D-025)", () => {
    for (const text of [
      "study gentle topics for 30 min",
      "revise the strict rules for 30 min",
      "read about adaptive filters for 30 min",
    ]) {
      const { draft, warnings } = parseIntent(text, ctx({ mode: "strict" }));
      expect(draft.mode, text).toBe("strict");
      expect(warnings.filter((w) => w.field === "plannedMin")).toEqual([]);
    }
  });

  it("falls back to the preference with no warning", () => {
    const { draft, warnings } = parseIntent("study chemistry for 1 hour", ctx({ mode: "adaptive" }));
    expect(draft.mode).toBe("adaptive");
    expect(warnings).toEqual([]);
  });

  it("does not take a mode word out of a span another step took", () => {
    // "strict" inside the duration span can't happen, but a site name can be a mode-like word.
    expect(parseIntent("study on strict.example.com for 1 hour", ctx({ mode: "gentle" })).draft.mode).toBe("gentle");
  });
});

describe("the pipeline never returns an invalid draft (§10)", () => {
  it("falls back to a safe draft when a step produces something the validators refuse", () => {
    // A dictionary entry with an invalid host is the one way a step can break the draft.
    const broken = [{ host: "NOT A HOST", names: ["brokensite"], mixedUse: false }];
    const { draft, warnings } = parseIntent("study on brokensite for 1 hour", ctx({ sites: broken }));
    expect(draft).toEqual({
      taskLabel: "Focus session",
      objective: "",
      allowedHosts: [],
      keywords: [],
      plannedMin: 60,
      mode: "gentle",
    });
    // The safe draft discards every field the other warnings describe, so parse_failed
    // is the only warning returned (§10).
    expect(warnings.map((w) => w.code)).toEqual(["parse_failed"]);
  });

  it("handles text longer than the envelope limit without throwing", () => {
    const { draft } = parseIntent("read the notes ".repeat(500), ctx());
    expect(draft.taskLabel.length).toBeLessThanOrEqual(LIMITS.taskLabel);
    expect(TEXT_MAX).toBe(1000);
  });

  it("works with an empty dictionary", () => {
    const { draft } = parseIntent("study on youtube for 1 hour", ctx({ sites: [] }));
    expect(draft.allowedHosts).toEqual([]);
    expect(SITES.length).toBeGreaterThan(0);
  });
});

describe("warning data (principle 3)", () => {
  it("never carries the whole sentence", () => {
    const text = "write the dissertation chapter about recursion by 9am in the quiet library";
    const { warnings } = parseIntent(text, ctx());
    for (const w of warnings) {
      const data = w.data ?? {};
      for (const value of [data.value ?? "", ...(data.names ?? [])]) {
        expect(value.length).toBeLessThanOrEqual(24);
        expect(text).not.toBe(value);
        expect(text.includes(value) && value.length > 24).toBe(false);
      }
    }
  });

  it("codes are stable identifiers, not copy", () => {
    const seen: WarningCode[] = [...WARNING_CODES];
    for (const code of seen) expect(code).toMatch(/^[a-z][a-z_]{3,30}$/);
  });
});
