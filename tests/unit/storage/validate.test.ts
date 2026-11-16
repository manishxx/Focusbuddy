// Strict validators (DATA_MODEL §2, §3, §8).
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, defaultPreferences } from "../../../src/core/storage/defaults";
import {
  Checker,
  isPlainObject,
  isValidHhmm,
  isValidHost,
  safeKey,
  validateActiveState,
  validateDiagEntry,
  validateInterventionRecord,
  validateMeta,
  validateOverride,
  validatePreferences,
  validateSegment,
  validateSessionConfig,
  validateSessionRecord,
  type Result,
} from "../../../src/core/storage/validate";
import { activeState, intervention, segment, sessionRecord } from "./fixtures";

function errorsOf<T>(r: Result<T>): string[] {
  return r.ok ? [] : r.errors;
}
const ok = <T>(r: Result<T>): boolean => r.ok;

describe("isValidHost", () => {
  it.each([
    "example.com",
    "docs.example.com",
    "localhost",
    "a-b.c-d.org",
    "xn--bcher-kva.example",
    "192.168.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "a1.b2",
  ])("accepts %s", (h) => expect(isValidHost(h)).toBe(true));

  it.each([
    "",
    "Example.com",
    "EXAMPLE.COM",
    "example.com/path",
    "example.com:8080",
    "example.com?q=1",
    "example.com#frag",
    "user@example.com",
    "exa mple.com",
    " example.com",
    "example.com.",
    ".example.com",
    "a..b",
    "-a.com",
    "a-.com",
    "[::1]",
    "::1",
    "2001:db8::1",
    "256.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.2.3.4",
    "a.123",
    "bücher.example",
    "a".repeat(64) + ".com",
    ("a".repeat(63) + ".").repeat(4) + "com",
    "https://example.com",
    "example.com\n",
  ])("rejects %j", (h) => expect(isValidHost(h)).toBe(false));

  it("rejects non-strings", () => {
    for (const v of [null, undefined, 1, {}, ["a.com"]]) expect(isValidHost(v)).toBe(false);
  });
});

describe("isValidHhmm", () => {
  it.each(["00:00", "09:30", "23:59", "12:00"])("accepts %s", (v) => expect(isValidHhmm(v)).toBe(true));
  it.each(["24:00", "23:60", "9:30", "0930", "09:3", "aa:bb", "", " 09:30"])("rejects %j", (v) =>
    expect(isValidHhmm(v)).toBe(false),
  );
  it("rejects non-strings", () => expect(isValidHhmm(930)).toBe(false));
});

describe("primitives", () => {
  it("isPlainObject accepts only plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject("x")).toBe(false);
  });

  it("safeKey never echoes free text", () => {
    expect(safeKey("title")).toBe("title");
    expect(safeKey("My secret page title")).toBe("?");
    expect(safeKey("https://x")).toBe("?");
  });

  it("Checker number checks reject NaN, Infinity and non-integers", () => {
    const c = new Checker();
    c.num(Number.NaN, "a");
    c.num(Number.POSITIVE_INFINITY, "b");
    c.num("1", "c");
    c.int(1.5, "d");
    c.int(5, "e", 6);
    c.int(9, "f", 0, 8);
    c.time(-1, "g");
    c.str("abc", "h", 2);
    c.str("", "i", 5, 1);
    c.bool("true", "j");
    c.arr("x", "k", 1, (x) => x);
    c.arr([1, 2], "l", 1, (x) => x);
    c.counts([], "m", () => true);
    c.id("has space", "n");
    c.hhmm("25:00", "o");
    expect(c.errors).toEqual([
      "a:not_finite_number",
      "b:not_finite_number",
      "c:not_finite_number",
      "d:not_integer",
      "e:below_min",
      "f:above_max",
      "g:below_min",
      "h:too_long",
      "i:too_short",
      "j:not_boolean",
      "k:not_array",
      "l:too_many",
      "m:not_object",
      "n:invalid_id",
      "o:invalid_time_of_day",
    ]);
  });
});

describe("validatePreferences (strict)", () => {
  it("accepts the defaults and does not share references with them", () => {
    const r = validatePreferences(defaultPreferences());
    expect(r).toEqual({ ok: true, value: defaultPreferences() });
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PREFERENCES.cooldownMin)).toBe(true);
    const a = defaultPreferences();
    a.userExclusions.push("x.com");
    expect(defaultPreferences().userExclusions).toEqual([]);
  });

  it("matches DATA_MODEL §2 defaults", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({
      schemaVersion: 1,
      defaultMode: "gentle",
      driftThresholdSec: 90,
      recoveryThresholdSec: 20,
      idleThresholdSec: 300,
      cooldownMin: { gentle: 15, adaptive: 10, strict: 5 },
      maxPerHour: 4,
      maxPerSession: 12,
      notificationsEnabled: true,
      shortcutMuteMin: 60,
      privateNotifications: false,
      overlay: { enabled: false, countdownSec: 5, showTaskLabel: false },
      incognitoMonitoring: false,
      userExclusions: [],
      retentionDays: 30,
      ai: { enabled: false },
    });
  });

  it("accepts boundary values and quiet hours", () => {
    const p = {
      ...defaultPreferences(),
      driftThresholdSec: 600,
      recoveryThresholdSec: 10,
      idleThresholdSec: 1800,
      cooldownMin: { gentle: 10, adaptive: 5, strict: 3 },
      maxPerHour: 6,
      maxPerSession: 30,
      sound: { enabled: false, tone: "bell", volume: 1 },
      notificationsSeen: false,
      shortcutMuteMin: -1,
      overlay: { enabled: true, countdownSec: 10, showTaskLabel: true },
      quietHours: { start: "22:00", end: "07:00" },
      userExclusions: Array.from({ length: 200 }, (_, i) => `h${i}.example`),
      retentionDays: 0,
      ai: { enabled: false, provider: "mock" },
    };
    expect(errorsOf(validatePreferences(p))).toEqual([]);
  });

  it.each([
    ["driftThresholdSec", 59],
    ["driftThresholdSec", 601],
    ["recoveryThresholdSec", 9],
    ["idleThresholdSec", 1801],
    ["cooldownMin", { gentle: 9, adaptive: 10, strict: 5 }],
    ["cooldownMin", { gentle: 15, adaptive: 4, strict: 5 }],
    ["cooldownMin", { gentle: 15, adaptive: 10, strict: 2 }],
    ["cooldownMin", { gentle: 15, adaptive: 10 }],
    ["maxPerHour", 7],
    ["maxPerHour", 0],
    ["maxPerSession", 31],
    ["sound", { enabled: true, tone: "siren", volume: 0.5 }],
    ["sound", { enabled: true, tone: "chime", volume: 1.1 }],
    ["sound", { enabled: true, tone: "chime", volume: Number.NaN }],
    ["notificationsSeen", "yes"],
    ["shortcutMuteMin", 30],
    ["overlay", { enabled: true, countdownSec: 4, showTaskLabel: false }],
    ["quietHours", { start: "24:00", end: "07:00" }],
    ["quietHours", { start: "22:00" }],
    ["userExclusions", Array.from({ length: 201 }, (_, i) => `h${i}.example`)],
    ["userExclusions", ["Example.com"]],
    ["userExclusions", ["example.com/path"]],
    ["retentionDays", 91],
    ["retentionDays", -1],
    ["retentionDays", 1.5],
    ["ai", { enabled: true, provider: "none" }],
    ["ai", { enabled: false, provider: "openai" }],
    ["defaultMode", "zen"],
    ["schemaVersion", 2],
    ["onboardingDone", 1],
    ["driftThresholdSec", Number.POSITIVE_INFINITY],
  ])("rejects %s = %j", (key, value) => {
    const r = validatePreferences({ ...defaultPreferences(), [key]: value });
    expect(r.ok).toBe(false);
    expect(errorsOf(r).some((e) => e.startsWith(`prefs.${key}`))).toBe(true);
  });

  it("rejects unknown keys, missing keys and non-objects", () => {
    expect(errorsOf(validatePreferences({ ...defaultPreferences(), title: "x" }))).toContain("prefs.title:unknown_key");
    const missing: Record<string, unknown> = { ...defaultPreferences() };
    delete missing.sound;
    expect(errorsOf(validatePreferences(missing))).toContain("prefs.sound:missing");
    expect(errorsOf(validatePreferences(null))).toContain("prefs:not_object");
    expect(
      errorsOf(
        validatePreferences({ ...defaultPreferences(), sound: { enabled: true, tone: "chime", volume: 1, x: 1 } }),
      ),
    ).toContain("prefs.sound.x:unknown_key");
  });
});

describe("validateOverride", () => {
  it("accepts with and without titleSubstring", () => {
    expect(ok(validateOverride({ host: "news.example", createdAt: 1 }))).toBe(true);
    expect(ok(validateOverride({ host: "news.example", titleSubstring: "x".repeat(60), createdAt: 1 }))).toBe(true);
  });
  it("rejects long or empty substrings, bad hosts and extra keys", () => {
    expect(errorsOf(validateOverride({ host: "a.com", titleSubstring: "x".repeat(61), createdAt: 1 }))).toEqual([
      "override.titleSubstring:too_long",
    ]);
    expect(ok(validateOverride({ host: "a.com", titleSubstring: "", createdAt: 1 }))).toBe(false);
    expect(ok(validateOverride({ host: "a.com/x", createdAt: 1 }))).toBe(false);
    expect(ok(validateOverride({ host: "a.com", createdAt: 1, url: "https://a.com/x" }))).toBe(false);
    expect(ok(validateOverride({ host: "a.com", createdAt: -5 }))).toBe(false);
  });
});

describe("validateSessionConfig", () => {
  const base = { taskLabel: "t", objective: "o", allowedHosts: ["a.com"], keywords: ["k"], mode: "strict" };
  it("accepts a config, with and without nextStep", () => {
    expect(ok(validateSessionConfig(base))).toBe(true);
    expect(ok(validateSessionConfig({ ...base, nextStep: "n".repeat(500) }))).toBe(true);
  });
  it.each([
    ["taskLabel", "x".repeat(121)],
    ["objective", "x".repeat(301)],
    ["nextStep", "x".repeat(501)],
    ["allowedHosts", Array.from({ length: 51 }, (_, i) => `h${i}.com`)],
    ["allowedHosts", ["www.example.com"]],
    ["allowedHosts", ["Example.com"]],
    ["keywords", Array.from({ length: 41 }, (_, i) => `k${i}`)],
    ["keywords", [""]],
    ["mode", "zen"],
  ])("rejects %s = %j", (key, value) => {
    expect(ok(validateSessionConfig({ ...base, [key]: value }))).toBe(false);
  });
  it("accepts the maxima", () => {
    expect(
      ok(
        validateSessionConfig({
          ...base,
          taskLabel: "x".repeat(120),
          objective: "x".repeat(300),
          allowedHosts: Array.from({ length: 50 }, (_, i) => `h${i}.com`),
          keywords: Array.from({ length: 40 }, (_, i) => `k${i}`),
        }),
      ),
    ).toBe(true);
  });
  it("rejects the original sentence (not stored: minimisation)", () => {
    expect(errorsOf(validateSessionConfig({ ...base, sentence: "work on x" }))).toEqual([
      "config.sentence:unknown_key",
    ]);
  });
});

describe("validateActiveState", () => {
  it("accepts a full state and a minimal one", () => {
    expect(errorsOf(validateActiveState(activeState()))).toEqual([]);
    const minimal: Record<string, unknown> = { ...activeState() };
    delete minimal.current;
    delete minimal.lastRelevant;
    expect(errorsOf(validateActiveState(minimal))).toEqual([]);
  });

  it("accepts every optional field", () => {
    const s = activeState({
      pending: {
        interventionId: "i1",
        episodeId: "e1",
        level: 2,
        createdAt: 10,
        attemptedAt: 11,
        tabId: 3,
        host: "a.com",
      },
      policy: {
        level: 3,
        lastDeliveredAt: 5,
        deliveredAt: [1, 2],
        sessionCount: 2,
        repeatsByEpisode: { e1: 2 },
        mutedUntil: 99,
      },
      drift: { phase: "DRIFTED", since: 2, accumulatedMs: 1500, episodeId: "e1" },
      sessionOverrides: [{ host: "a.com", titleSubstring: "Docs", createdAt: 1 }],
    });
    s.session = {
      ...s.session,
      state: "ENDING",
      breakEndsAt: 9,
      ending: { endReason: "user_stop", endedAt: 9 },
      awaitingContinue: true,
      awaySince: 8,
    };
    expect(errorsOf(validateActiveState(s))).toEqual([]);
  });

  it("rejects a title, url or path anywhere", () => {
    expect(ok(validateActiveState({ ...activeState(), title: "Inbox" }))).toBe(false);
    const s = activeState();
    expect(ok(validateActiveState({ ...s, lastRelevant: { ...s.lastRelevant, title: "Inbox (3)" } }))).toBe(false);
    expect(ok(validateActiveState({ ...s, current: { ...s.current, url: "https://a.com/x" } }))).toBe(false);
    expect(ok(validateActiveState({ ...s, session: { ...s.session, path: "/x" } }))).toBe(false);
  });

  it.each([
    ["schemaVersion", 2],
    ["attention", "AWAY"],
    ["segSeq", -1],
    ["lastSeenAt", Number.NaN],
    ["drift", { phase: "LOST", since: 0, accumulatedMs: 0 }],
    ["policy", { level: 4, deliveredAt: [], sessionCount: 0, repeatsByEpisode: {} }],
    ["policy", { level: 0, deliveredAt: [], sessionCount: 0, repeatsByEpisode: { "bad key!": 1 } }],
    ["policy", { level: 0, deliveredAt: [-1], sessionCount: 0, repeatsByEpisode: {} }],
    ["current", { segmentSeq: 0, tabId: 1, obsKey: "Inbox (3) - Mail", class: "RELEVANT", since: 0 }],
    ["current", { segmentSeq: 0, tabId: 1, obsKey: 5, class: "RELEVANT", since: 0 }],
    ["lastRelevant", { tabId: 1, host: "a.com/inbox", at: 0 }],
    ["pending", { interventionId: "i", episodeId: "e", level: 0, createdAt: 0, tabId: 1 }],
    ["pending", { interventionId: "i", episodeId: "e", level: 1, createdAt: 0, tabId: 1, host: "A.com" }],
    ["sessionOverrides", [{ host: "a.com", createdAt: 0, extra: 1 }]],
  ])("rejects %s = %j", (key, value) => {
    expect(ok(validateActiveState({ ...activeState(), [key]: value }))).toBe(false);
  });

  it.each([
    ["state", "RUNNING"],
    ["plannedMin", 4],
    ["plannedMin", 481],
    ["extensionsMin", -1],
    ["id", ""],
    ["id", "x".repeat(65)],
    ["pauses", [{ from: 5, to: 4, kind: "pause" }]],
    ["pauses", [{ from: 5, kind: "nap" }]],
    ["ending", { endReason: "crash", endedAt: 1 }],
    ["awaitingContinue", "yes"],
  ])("rejects session.%s = %j", (key, value) => {
    const s = activeState();
    expect(ok(validateActiveState({ ...s, session: { ...s.session, [key]: value } }))).toBe(false);
  });
});

describe("validateSegment", () => {
  it("accepts open and closed segments, with or without host", () => {
    expect(errorsOf(validateSegment(segment()))).toEqual([]);
    const open: Record<string, unknown> = { ...segment() };
    delete open.end;
    expect(ok(validateSegment(open))).toBe(true);
    const noHost: Record<string, unknown> = { ...segment({ class: "EXCLUDED", reason: "excluded" }) };
    delete noHost.host;
    expect(ok(validateSegment(noHost))).toBe(true);
    expect(ok(validateSegment(segment({ attention: "AWAY", host: "10.0.0.1" })))).toBe(true);
  });

  it.each(["title", "url", "path"])("rejects a %s key (invariant 1)", (key) => {
    expect(errorsOf(validateSegment({ ...segment(), [key]: "x" }))).toEqual([`segment.${key}:unknown_key`]);
  });

  it.each(["excluded", "internal", "ephemeral"] as const)("rejects a host with reason %s (invariant 2)", (reason) => {
    expect(errorsOf(validateSegment(segment({ reason })))).toEqual(["segment.host:forbidden_for_reason"]);
  });

  it("rejects a host on an EXCLUDED segment", () => {
    expect(ok(validateSegment(segment({ class: "EXCLUDED", reason: "override" })))).toBe(false);
  });

  it.each([
    ["host", "docs.example.com/path"],
    ["host", "Docs.Example.com"],
    ["host", "docs.example.com:443"],
    ["host", "[2001:db8::1]"],
    ["end", 500],
    ["start", -1],
    ["seq", 1.5],
    ["class", "MAYBE"],
    ["reason", "guess"],
    ["attention", "ASLEEP"],
    ["sessionId", "a b"],
  ])("rejects %s = %j", (key, value) => {
    expect(ok(validateSegment({ ...segment(), [key]: value }))).toBe(false);
  });

  it("treats an explicit undefined optional as absent", () => {
    const r = validateSegment({ ...segment(), end: undefined });
    expect(r.ok && !("end" in r.value)).toBe(true);
  });
});

describe("validateInterventionRecord", () => {
  it("accepts with and without a response", () => {
    expect(errorsOf(validateInterventionRecord(intervention()))).toEqual([]);
    expect(ok(validateInterventionRecord(intervention({ response: "back", respondedAt: 6_000 })))).toBe(true);
  });
  it("rejects host and title keys (invariant 4)", () => {
    expect(errorsOf(validateInterventionRecord({ ...intervention(), host: "a.com" }))).toEqual([
      "intervention.host:unknown_key",
    ]);
    expect(ok(validateInterventionRecord({ ...intervention(), title: "x" }))).toBe(false);
  });
  it.each([
    ["level", 4],
    ["deliveredVia", ["email"]],
    ["deliveredVia", ["badge", "panel", "notification", "sound", "overlay", "page", "badge"]],
    ["response", "maybe"],
    ["respondedAt", Number.POSITIVE_INFINITY],
    ["createdAt", "now"],
  ])("rejects %s = %j", (key, value) => {
    expect(ok(validateInterventionRecord({ ...intervention(), [key]: value }))).toBe(false);
  });
});

describe("validateSessionRecord", () => {
  it("accepts a record, with objectiveDone and 10 relevant hosts", () => {
    expect(errorsOf(validateSessionRecord(sessionRecord()))).toEqual([]);
    const r = sessionRecord();
    r.summary.objectiveDone = true;
    r.summary.relevantHosts = Array.from({ length: 10 }, (_, i) => ({ host: `h${i}.com`, minutes: i }));
    expect(errorsOf(validateSessionRecord(r))).toEqual([]);
  });
  it("rejects 11 relevant hosts", () => {
    const r = sessionRecord();
    r.summary.relevantHosts = Array.from({ length: 11 }, (_, i) => ({ host: `h${i}.com`, minutes: i }));
    expect(errorsOf(validateSessionRecord(r))).toEqual(["sessionRecord.summary.relevantHosts:too_many"]);
  });
  it("rejects topHosts, titles and bad summary values", () => {
    const r = sessionRecord();
    expect(ok(validateSessionRecord({ ...r, summary: { ...r.summary, topHosts: [] } }))).toBe(false);
    expect(ok(validateSessionRecord({ ...r, title: "x" }))).toBe(false);
    expect(ok(validateSessionRecord({ ...r, summary: { ...r.summary, focusedMin: -1 } }))).toBe(false);
    expect(ok(validateSessionRecord({ ...r, summary: { ...r.summary, responses: { "a.com": 1 } } }))).toBe(false);
    expect(ok(validateSessionRecord({ ...r, summary: { ...r.summary, responses: { back: 1.5 } } }))).toBe(false);
    expect(
      ok(validateSessionRecord({ ...r, summary: { ...r.summary, relevantHosts: [{ host: "a.com/x", minutes: 1 }] } })),
    ).toBe(false);
    expect(ok(validateSessionRecord({ ...r, endedAt: 500 }))).toBe(false);
    expect(ok(validateSessionRecord({ ...r, endReason: "crash" }))).toBe(false);
    expect(ok(validateSessionRecord({ ...r, taskLabel: "x".repeat(121) }))).toBe(false);
    expect(ok(validateSessionRecord({ ...r, objective: "x".repeat(301) }))).toBe(false);
  });
});

describe("validateMeta and validateDiagEntry", () => {
  it("meta", () => {
    expect(ok(validateMeta({ schemaVersion: 1, installedAt: 0 }))).toBe(true);
    expect(ok(validateMeta({ schemaVersion: 2, installedAt: 0 }))).toBe(false);
    expect(ok(validateMeta({ schemaVersion: 1 }))).toBe(false);
    expect(ok(validateMeta({ schemaVersion: 1, installedAt: 0, x: 1 }))).toBe(false);
  });
  it("diag entries", () => {
    expect(ok(validateDiagEntry({ at: 1, code: "E_IDB_OPEN" }))).toBe(true);
    expect(ok(validateDiagEntry({ at: 1, code: "failed at https://a.com" }))).toBe(false);
    expect(ok(validateDiagEntry({ at: 1, code: "e_lower" }))).toBe(false);
    expect(ok(validateDiagEntry({ at: 1, code: "E_" + "X".repeat(40) }))).toBe(false);
    expect(ok(validateDiagEntry({ at: 1, code: "E_OK", msg: "x" }))).toBe(false);
  });
});

describe("DATA_MODEL §8.1 bounds: accept at the limit, reject at limit + 1", () => {
  const prefsWith = (over: Record<string, unknown>) => validatePreferences({ ...defaultPreferences(), ...over });

  it.each(["gentle", "adaptive", "strict"] as const)("cooldownMin.%s ≤ 120", (mode) => {
    const at = { ...defaultPreferences().cooldownMin, [mode]: 120 };
    const over = { ...defaultPreferences().cooldownMin, [mode]: 121 };
    expect(errorsOf(prefsWith({ cooldownMin: at }))).toEqual([]);
    expect(errorsOf(prefsWith({ cooldownMin: over }))).toEqual([`prefs.cooldownMin.${mode}:above_max`]);
  });

  it("quietHours start ≠ end", () => {
    expect(errorsOf(prefsWith({ quietHours: { start: "22:00", end: "22:01" } }))).toEqual([]);
    expect(errorsOf(prefsWith({ quietHours: { start: "22:00", end: "22:00" } }))).toEqual([
      "prefs.quietHours.end:equals_start",
    ]);
  });

  const withSession = (over: Record<string, unknown>) => {
    const s = activeState();
    return validateActiveState({ ...s, session: { ...s.session, ...over } });
  };

  it("plannedMin + extensionsMin ≤ 480", () => {
    expect(errorsOf(withSession({ plannedMin: 400, extensionsMin: 80 }))).toEqual([]);
    expect(errorsOf(withSession({ plannedMin: 480, extensionsMin: 0 }))).toEqual([]);
    expect(errorsOf(withSession({ plannedMin: 400, extensionsMin: 81 }))).toEqual([
      "active.session.extensionsMin:total_above_max",
    ]);
  });

  it("pauses ≤ 200", () => {
    const pauses = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ from: 2_000 + i, to: 2_000 + i, kind: "pause" }));
    expect(errorsOf(withSession({ pauses: pauses(200) }))).toEqual([]);
    expect(errorsOf(withSession({ pauses: pauses(201) }))).toEqual(["active.session.pauses:too_many"]);
  });

  const withPolicy = (over: Record<string, unknown>) => {
    const s = activeState();
    return validateActiveState({ ...s, policy: { ...s.policy, ...over } });
  };

  it("policy.deliveredAt ≤ 50", () => {
    const times = (n: number) => Array.from({ length: n }, (_, i) => i);
    expect(errorsOf(withPolicy({ deliveredAt: times(50) }))).toEqual([]);
    expect(errorsOf(withPolicy({ deliveredAt: times(51) }))).toEqual(["active.policy.deliveredAt:too_many"]);
  });

  it("policy.repeatsByEpisode ≤ 100 keys", () => {
    const keys = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`e${i}`, 1]));
    expect(errorsOf(withPolicy({ repeatsByEpisode: keys(100) }))).toEqual([]);
    expect(errorsOf(withPolicy({ repeatsByEpisode: keys(101) }))).toEqual(["active.policy.repeatsByEpisode:too_many"]);
  });

  it("sessionOverrides ≤ 50", () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => ({ host: `h${i}.com`, createdAt: 1 }));
    expect(errorsOf(validateActiveState({ ...activeState(), sessionOverrides: list(50) }))).toEqual([]);
    expect(errorsOf(validateActiveState({ ...activeState(), sessionOverrides: list(51) }))).toEqual([
      "active.sessionOverrides:too_many",
    ]);
  });

  it("taskLabel 1–120 (session config and session record)", () => {
    const base = { taskLabel: "t", objective: "", allowedHosts: [], keywords: [], mode: "gentle" };
    expect(errorsOf(validateSessionConfig(base))).toEqual([]);
    expect(errorsOf(validateSessionConfig({ ...base, taskLabel: "" }))).toEqual(["config.taskLabel:too_short"]);
    expect(errorsOf(validateSessionRecord(sessionRecord({ taskLabel: "x" })))).toEqual([]);
    expect(errorsOf(validateSessionRecord(sessionRecord({ taskLabel: "" })))).toEqual([
      "sessionRecord.taskLabel:too_short",
    ]);
  });

  it("lastSeenAt ≥ session.startedAt", () => {
    const s = activeState();
    expect(errorsOf(validateActiveState({ ...s, lastSeenAt: s.session.startedAt }))).toEqual([]);
    expect(errorsOf(validateActiveState({ ...s, lastSeenAt: s.session.startedAt - 1 }))).toEqual([
      "active.lastSeenAt:before_session_start",
    ]);
  });
});
