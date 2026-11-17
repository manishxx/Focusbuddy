/**
 * Strict, hand-written validators for every persisted record (DATA_MODEL §2, §3, §8).
 *
 * - Strict: an unknown key fails the record, so a stray `title`, `url` or `path`
 *   field can never be written or read back (invariant 1 enforced by structure).
 * - Every value is rebuilt from known fields, so the returned value never carries
 *   anything the type doesn't name.
 * - Numbers must be finite; timestamps must be ≥ 0.
 * - Error strings are `<path>:<code>`. Paths only echo key names that look like
 *   identifiers, so an error can't carry user text (ARCHITECTURE §10).
 *
 * Preferences are the one exception to strictness on read: parsePreferences()
 * falls back per field (AC-15). Writes use the strict validatePreferences().
 */
import type {
  ActiveSession,
  ActiveState,
  Attention,
  DeliveryChannel,
  DiagEntry,
  DriftPhase,
  EndReason,
  InterventionRecord,
  InterventionResponse,
  Meta,
  Mode,
  Notified,
  Override,
  PauseKind,
  Preferences,
  ReasonCode,
  RelevanceClass,
  Segment,
  SegmentAttention,
  SessionConfig,
  SessionRecord,
  SessionState,
  SessionSummary,
  SoundTone,
} from "../types";
import { defaultPreferences } from "./defaults";
import { nullObject, trySnapshot } from "./snapshot";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

// ---- enums ----

export const MODES: readonly [Mode, ...Mode[]] = ["gentle", "adaptive", "strict"];
export const SOUND_TONES: readonly [SoundTone, ...SoundTone[]] = ["chime", "soft", "bell"];
export const SESSION_STATES: readonly [SessionState, ...SessionState[]] = ["ACTIVE", "PAUSED", "ON_BREAK", "ENDING"];
export const ATTENTIONS: readonly [Attention, ...Attention[]] = ["ACTIVE_INPUT", "IDLE", "LOCKED", "BROWSER_UNFOCUSED"];
export const SEGMENT_ATTENTIONS: readonly [SegmentAttention, ...SegmentAttention[]] = [
  "ACTIVE_INPUT",
  "IDLE",
  "LOCKED",
  "BROWSER_UNFOCUSED",
  "AWAY",
];
export const PAUSE_KINDS: readonly [PauseKind, ...PauseKind[]] = ["pause", "break", "auto_absent"];
export const DRIFT_PHASES: readonly [DriftPhase, ...DriftPhase[]] = [
  "ON_TASK",
  "DRIFT_PENDING",
  "DRIFTED",
  "RECOVERING",
];
export const END_REASONS: readonly [EndReason, ...EndReason[]] = [
  "time_up",
  "user_stop",
  "expired_while_closed",
  "stale_pause",
  "deleted_all",
];
export const RELEVANCE_CLASSES: readonly [RelevanceClass, ...RelevanceClass[]] = [
  "RELEVANT",
  "UNCERTAIN",
  "LIKELY_IRRELEVANT",
  "EXCLUDED",
];
export const REASON_CODES: readonly [ReasonCode, ...ReasonCode[]] = [
  "excluded",
  "internal",
  "placeholder",
  "override",
  "allowed_host",
  "keyword",
  "distraction_rule",
  "mixed_use_no_match",
  "not_allowed_no_match",
  "ai",
  "ephemeral",
];
/** Invariant 2: segments with these reasons (or class EXCLUDED) never have a host. */
export const HOSTLESS_REASONS: readonly [ReasonCode, ...ReasonCode[]] = ["excluded", "internal", "ephemeral"];
export const DELIVERY_CHANNELS: readonly [DeliveryChannel, ...DeliveryChannel[]] = [
  "badge",
  "panel",
  "notification",
  "sound",
  "overlay",
  "page",
];
export const RESPONSES: readonly [InterventionResponse, ...InterventionResponse[]] = [
  "back",
  "relevant",
  "break",
  "mute",
  "stop",
  "continue",
  "dismissed",
  "ignored",
];

/** DATA_MODEL v1.3 `ActiveState.notified` keys. */
export const NOTIFIED_KEYS: readonly (keyof Notified)[] = ["start", "continuePrompt", "breakOver", "breakRepeat"];

// ---- limits (DATA_MODEL §2, PRD FR-S1) ----

export const LIMITS = {
  taskLabel: 120,
  objective: 300,
  nextStep: 500,
  titleSubstring: 60,
  allowedHosts: 50,
  keywords: 40,
  keywordLength: 100,
  userExclusions: 200,
  relevantHosts: 10,
  // DATA_MODEL §8.1 upper bounds.
  cooldownMax: 120,
  pauses: 200,
  deliveredAt: 50,
  repeatsByEpisode: 100,
  sessionOverrides: 50,
  overridesGlobal: 200,
  plannedMinMin: 5,
  plannedMinMax: 480,
  hostLength: 253,
} as const;

// ---- primitives ----

type Obj = Record<string, unknown>;

export function isPlainObject(v: unknown): v is Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_.]{0,40}$/;
/** A key name that is safe to echo in an error or a resetFields entry. */
export function safeKey(k: string): string {
  return SAFE_KEY.test(k) ? k : "?";
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DIGITS = /^[0-9]+$/;
const OCTET = /^(?:0|[1-9][0-9]{0,2})$/;

/**
 * A bare, normalised hostname (DATA_MODEL §8): lowercase letters, digits, `-` and
 * `.`; IDNs in `xn--` form; IPv4 allowed. No port, path, query, fragment,
 * userinfo, spaces, upper case, IPv6 literal or trailing dot.
 */
export function isValidHost(h: unknown): h is string {
  if (typeof h !== "string" || h.length === 0 || h.length > LIMITS.hostLength) return false;
  const labels = h.split(".");
  if (!labels.every((l) => LABEL.test(l))) return false;
  const last = labels[labels.length - 1] ?? "";
  if (DIGITS.test(last)) {
    // A numeric final label means an IPv4 literal (as browsers parse it).
    return labels.length === 4 && labels.every((l) => OCTET.test(l) && Number(l) <= 255);
  }
  return true;
}

const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
export function isValidHhmm(v: unknown): v is string {
  return typeof v === "string" && HHMM.test(v);
}

/** Record ids: random tokens (e.g. crypto.randomUUID()); never user text. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** current.obsKey is a hash (ARCHITECTURE §5 step 8), never a raw title. */
const OBS_KEY = /^[A-Za-z0-9+/=_:-]{1,128}$/;

/** Keys never accepted in a record-like map, even if they would pass its key check. */
export const FORBIDDEN_MAP_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

/**
 * Override.titleSubstring is a plain word or phrase (review F12): no URL pieces
 * (`://`, `/`, `?`, `#`, `@`), no control characters, no format characters (\p{Cf})
 * and no line or paragraph separators (\p{Zl}, \p{Zp}).
 */
export function isSafeTitleSubstring(v: string): boolean {
  if (/[/?#@]/.test(v)) return false;
  // Invisible format characters (e.g. U+200B, U+202E) and line/paragraph separators (N3).
  if (/[\p{Cf}\p{Zl}\p{Zp}]/u.test(v)) return false;
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

/** Collects errors; every check returns a well-typed fallback so callers can build values. */
export class Checker {
  readonly errors: string[] = [];

  fail(path: string, code: string): void {
    this.errors.push(`${path}:${code}`);
  }

  /** A plain object with exactly the allowed keys. Present-but-undefined counts as absent. */
  obj(v: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Obj {
    if (!isPlainObject(v)) {
      this.fail(path, "not_object");
      return {};
    }
    for (const k of Object.keys(v)) {
      if (!required.includes(k) && !optional.includes(k)) this.fail(`${path}.${safeKey(k)}`, "unknown_key");
    }
    for (const k of required) {
      if (!Object.hasOwn(v, k) || v[k] === undefined) this.fail(`${path}.${k}`, "missing");
    }
    return v;
  }

  num(v: unknown, path: string, o: { min?: number; max?: number; int?: boolean } = {}): number {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.fail(path, "not_finite_number");
      return 0;
    }
    if (o.int === true && !Number.isInteger(v)) this.fail(path, "not_integer");
    else if (o.min !== undefined && v < o.min) this.fail(path, "below_min");
    else if (o.max !== undefined && v > o.max) this.fail(path, "above_max");
    return v;
  }

  int(v: unknown, path: string, min?: number, max?: number): number {
    return this.num(v, path, { int: true, ...(min !== undefined && { min }), ...(max !== undefined && { max }) });
  }

  /** Epoch ms timestamp: finite and ≥ 0. */
  time(v: unknown, path: string): number {
    return this.num(v, path, { min: 0 });
  }

  str(v: unknown, path: string, max: number, min = 0): string {
    if (typeof v !== "string") {
      this.fail(path, "not_string");
      return "";
    }
    if (v.length > max) this.fail(path, "too_long");
    else if (v.length < min) this.fail(path, "too_short");
    return v;
  }

  bool(v: unknown, path: string): boolean {
    if (typeof v !== "boolean") {
      this.fail(path, "not_boolean");
      return false;
    }
    return v;
  }

  oneOf<T extends string | number | boolean | null>(v: unknown, path: string, values: readonly [T, ...T[]]): T {
    for (const x of values) if (x === v) return x;
    this.fail(path, "not_allowed_value");
    return values[0];
  }

  arr<T>(v: unknown, path: string, max: number, item: (x: unknown, p: string) => T): T[] {
    if (!Array.isArray(v)) {
      this.fail(path, "not_array");
      return [];
    }
    if (v.length > max) {
      this.fail(path, "too_many");
      return [];
    }
    const items: unknown[] = v;
    const out: T[] = [];
    // Index loop, not map(): map() skips holes, so a hole would escape validation.
    for (let i = 0; i < items.length; i++) {
      if (!(i in items)) {
        this.fail(`${path}[${i}]`, "hole");
        continue;
      }
      out.push(item(items[i], `${path}[${i}]`));
    }
    return out;
  }

  host(v: unknown, path: string): string {
    if (!isValidHost(v)) {
      this.fail(path, "invalid_host");
      return "";
    }
    return v;
  }

  id(v: unknown, path: string): string {
    if (typeof v !== "string" || !ID.test(v)) {
      this.fail(path, "invalid_id");
      return "";
    }
    return v;
  }

  hhmm(v: unknown, path: string): string {
    if (!isValidHhmm(v)) {
      this.fail(path, "invalid_time_of_day");
      return "00:00";
    }
    return v;
  }

  /** A string-keyed map whose keys pass `key` and whose values are counts ≥ 0. */
  counts(
    v: unknown,
    path: string,
    key: (k: string) => boolean,
    maxKeys: number = Number.MAX_SAFE_INTEGER,
  ): Record<string, number> {
    if (!isPlainObject(v)) {
      this.fail(path, "not_object");
      return {};
    }
    if (Object.keys(v).length > maxKeys) {
      this.fail(path, "too_many");
      return {};
    }
    // Null prototype, and the prototype-related names are refused outright (review F4).
    const out = nullObject<number>();
    for (const [k, value] of Object.entries(v)) {
      if (FORBIDDEN_MAP_KEYS.includes(k) || !key(k)) {
        this.fail(`${path}.${safeKey(k)}`, "invalid_key");
        continue;
      }
      out[k] = this.int(value, `${path}.${k}`, 0);
    }
    return out;
  }

  result<T>(value: T): Result<T> {
    return this.errors.length === 0 ? { ok: true, value } : { ok: false, errors: [...this.errors] };
  }
}

/** Reads an optional field: undefined when absent (or explicitly undefined). */
function opt<T>(o: Obj, key: string, read: (v: unknown) => T): T | undefined {
  const v = o[key];
  return v === undefined ? undefined : read(v);
}

const isId = (k: string): boolean => ID.test(k);
const isResponse = (k: string): boolean => RESPONSES.some((r) => r === k);

// ---- preferences (strict form, for writes) ----

type PrefParsers = { [K in keyof Preferences]: (v: unknown, c: Checker, path: string) => Preferences[K] };

export const PREF_PARSERS: PrefParsers = {
  schemaVersion: (v, c, p) => c.oneOf(v, p, [1]),
  defaultMode: (v, c, p) => c.oneOf(v, p, MODES),
  driftThresholdSec: (v, c, p) => c.int(v, p, 60, 600),
  recoveryThresholdSec: (v, c, p) => c.int(v, p, 10, 120),
  idleThresholdSec: (v, c, p) => c.int(v, p, 15, 1800),
  cooldownMin: (v, c, p) => {
    const o = c.obj(v, p, ["gentle", "adaptive", "strict"]);
    return {
      gentle: c.int(o.gentle, `${p}.gentle`, 10, LIMITS.cooldownMax),
      adaptive: c.int(o.adaptive, `${p}.adaptive`, 5, LIMITS.cooldownMax),
      strict: c.int(o.strict, `${p}.strict`, 3, LIMITS.cooldownMax),
    };
  },
  maxPerHour: (v, c, p) => c.int(v, p, 1, 6),
  maxPerSession: (v, c, p) => c.int(v, p, 1, 30),
  sound: (v, c, p) => {
    const o = c.obj(v, p, ["enabled", "tone", "volume"]);
    return {
      enabled: c.bool(o.enabled, `${p}.enabled`),
      tone: c.oneOf(o.tone, `${p}.tone`, SOUND_TONES),
      volume: c.num(o.volume, `${p}.volume`, { min: 0, max: 1 }),
    };
  },
  notificationsEnabled: (v, c, p) => c.bool(v, p),
  notificationsSeen: (v, c, p) => c.oneOf<null | boolean>(v, p, [null, true, false]),
  shortcutMuteMin: (v, c, p) => c.oneOf(v, p, [15, 60, -1]),
  privateNotifications: (v, c, p) => c.bool(v, p),
  overlay: (v, c, p) => {
    const o = c.obj(v, p, ["enabled", "countdownSec", "showTaskLabel"]);
    return {
      enabled: c.bool(o.enabled, `${p}.enabled`),
      countdownSec: c.oneOf(o.countdownSec, `${p}.countdownSec`, [5, 6, 7, 8, 9, 10]),
      showTaskLabel: c.bool(o.showTaskLabel, `${p}.showTaskLabel`),
    };
  },
  quietHours: (v, c, p) => {
    if (v === null) return null;
    const o = c.obj(v, p, ["start", "end"]);
    const start = c.hhmm(o.start, `${p}.start`);
    const end = c.hhmm(o.end, `${p}.end`);
    if (isValidHhmm(o.start) && isValidHhmm(o.end) && start === end) c.fail(`${p}.end`, "equals_start");
    return { start, end };
  },
  incognitoMonitoring: (v, c, p) => c.bool(v, p),
  userExclusions: (v, c, p) => c.arr(v, p, LIMITS.userExclusions, (x, ip) => c.host(x, ip)),
  retentionDays: (v, c, p) => c.int(v, p, 0, 90),
  ai: (v, c, p) => {
    const o = c.obj(v, p, ["enabled", "provider"]);
    return {
      enabled: c.oneOf(o.enabled, `${p}.enabled`, [false]),
      provider: c.oneOf(o.provider, `${p}.provider`, ["none", "mock"] as const),
    };
  },
  onboardingDone: (v, c, p) => c.bool(v, p),
};

export const PREF_KEYS: readonly (keyof Preferences)[] = [
  "schemaVersion",
  "defaultMode",
  "driftThresholdSec",
  "recoveryThresholdSec",
  "idleThresholdSec",
  "cooldownMin",
  "maxPerHour",
  "maxPerSession",
  "sound",
  "notificationsEnabled",
  "notificationsSeen",
  "shortcutMuteMin",
  "privateNotifications",
  "overlay",
  "quietHours",
  "incognitoMonitoring",
  "userExclusions",
  "retentionDays",
  "ai",
  "onboardingDone",
];

/** Builds a Preferences value field by field from `field`. */
export function buildPreferences(field: <K extends keyof Preferences>(k: K) => Preferences[K]): Preferences {
  return {
    schemaVersion: field("schemaVersion"),
    defaultMode: field("defaultMode"),
    driftThresholdSec: field("driftThresholdSec"),
    recoveryThresholdSec: field("recoveryThresholdSec"),
    idleThresholdSec: field("idleThresholdSec"),
    cooldownMin: field("cooldownMin"),
    maxPerHour: field("maxPerHour"),
    maxPerSession: field("maxPerSession"),
    sound: field("sound"),
    notificationsEnabled: field("notificationsEnabled"),
    notificationsSeen: field("notificationsSeen"),
    shortcutMuteMin: field("shortcutMuteMin"),
    privateNotifications: field("privateNotifications"),
    overlay: field("overlay"),
    quietHours: field("quietHours"),
    incognitoMonitoring: field("incognitoMonitoring"),
    userExclusions: field("userExclusions"),
    retentionDays: field("retentionDays"),
    ai: field("ai"),
    onboardingDone: field("onboardingDone"),
  };
}

/** Strict: every field present and valid, no unknown keys. Used before every write. */
function validatePreferencesInner(v: unknown): Result<Preferences> {
  const c = new Checker();
  // notificationsSeen and quietHours may be null, which obj() treats as present.
  const o = c.obj(v, "prefs", PREF_KEYS);
  const value = buildPreferences((k) => PREF_PARSERS[k](o[k], c, `prefs.${k}`));
  return c.result(value);
}

// ---- settings tier ----

function readOverride(c: Checker, v: unknown, p: string): Override {
  const o = c.obj(v, p, ["host", "createdAt"], ["titleSubstring"]);
  const titleSubstring = opt(o, "titleSubstring", (x) => {
    const t = c.str(x, `${p}.titleSubstring`, LIMITS.titleSubstring, 1);
    if (!isSafeTitleSubstring(t)) c.fail(`${p}.titleSubstring`, "unsafe_characters");
    return t;
  });
  return {
    host: c.host(o.host, `${p}.host`),
    createdAt: c.time(o.createdAt, `${p}.createdAt`),
    ...(titleSubstring !== undefined && { titleSubstring }),
  };
}

function validateOverrideInner(v: unknown): Result<Override> {
  const c = new Checker();
  return c.result(readOverride(c, v, "override"));
}

// ---- raw tier ----

const SESSION_CONFIG_REQUIRED = ["taskLabel", "objective", "allowedHosts", "keywords", "mode"] as const;
const SESSION_CONFIG_OPTIONAL = ["nextStep"] as const;

function readSessionConfig(c: Checker, o: Obj, p: string): SessionConfig {
  const nextStep = opt(o, "nextStep", (x) => c.str(x, `${p}.nextStep`, LIMITS.nextStep));
  return {
    taskLabel: c.str(o.taskLabel, `${p}.taskLabel`, LIMITS.taskLabel, 1),
    objective: c.str(o.objective, `${p}.objective`, LIMITS.objective),
    allowedHosts: c.arr(o.allowedHosts, `${p}.allowedHosts`, LIMITS.allowedHosts, (x, ip) => {
      const h = c.host(x, ip);
      if (h.startsWith("www.")) c.fail(ip, "not_normalised");
      return h;
    }),
    keywords: c.arr(o.keywords, `${p}.keywords`, LIMITS.keywords, (x, ip) => c.str(x, ip, LIMITS.keywordLength, 1)),
    mode: c.oneOf(o.mode, `${p}.mode`, MODES),
    ...(nextStep !== undefined && { nextStep }),
  };
}

function validateSessionConfigInner(v: unknown): Result<SessionConfig> {
  const c = new Checker();
  const o = c.obj(v, "config", SESSION_CONFIG_REQUIRED, SESSION_CONFIG_OPTIONAL);
  return c.result(readSessionConfig(c, o, "config"));
}

function readActiveSession(c: Checker, v: unknown, p: string): ActiveSession {
  const o = c.obj(
    v,
    p,
    [...SESSION_CONFIG_REQUIRED, "id", "state", "startedAt", "plannedMin", "extensionsMin", "pauses"],
    [...SESSION_CONFIG_OPTIONAL, "breakEndsAt", "ending", "awaitingContinue", "awaySince"],
  );
  const breakEndsAt = opt(o, "breakEndsAt", (x) => c.time(x, `${p}.breakEndsAt`));
  const ending = opt(o, "ending", (x) => {
    const e = c.obj(x, `${p}.ending`, ["endReason", "endedAt"]);
    return {
      endReason: c.oneOf(e.endReason, `${p}.ending.endReason`, END_REASONS),
      endedAt: c.time(e.endedAt, `${p}.ending.endedAt`),
    };
  });
  const awaitingContinue = opt(o, "awaitingContinue", (x) => c.bool(x, `${p}.awaitingContinue`));
  const awaySince = opt(o, "awaySince", (x) => c.time(x, `${p}.awaySince`));
  const plannedMin = c.int(o.plannedMin, `${p}.plannedMin`, LIMITS.plannedMinMin, LIMITS.plannedMinMax);
  const extensionsMin = c.int(o.extensionsMin, `${p}.extensionsMin`, 0);
  if (plannedMin + extensionsMin > LIMITS.plannedMinMax) c.fail(`${p}.extensionsMin`, "total_above_max");
  return {
    ...readSessionConfig(c, o, p),
    id: c.id(o.id, `${p}.id`),
    state: c.oneOf(o.state, `${p}.state`, SESSION_STATES),
    startedAt: c.time(o.startedAt, `${p}.startedAt`),
    plannedMin,
    extensionsMin,
    pauses: c.arr(o.pauses, `${p}.pauses`, LIMITS.pauses, (x, ip) => {
      const q = c.obj(x, ip, ["from", "kind"], ["to"]);
      const from = c.time(q.from, `${ip}.from`);
      const to = opt(q, "to", (y) => c.time(y, `${ip}.to`));
      if (to !== undefined && to < from) c.fail(`${ip}.to`, "before_from");
      return { from, kind: c.oneOf(q.kind, `${ip}.kind`, PAUSE_KINDS), ...(to !== undefined && { to }) };
    }),
    ...(breakEndsAt !== undefined && { breakEndsAt }),
    ...(ending !== undefined && { ending }),
    ...(awaitingContinue !== undefined && { awaitingContinue }),
    ...(awaySince !== undefined && { awaySince }),
  };
}

function validateActiveStateInner(v: unknown): Result<ActiveState> {
  const c = new Checker();
  const p = "active";
  const o = c.obj(
    v,
    p,
    [
      "schemaVersion",
      "session",
      "lastSeenAt",
      "attention",
      "attentionSince",
      "awayMs",
      "notified",
      "drift",
      "policy",
      "sessionOverrides",
      "segSeq",
    ],
    ["current", "lastRelevant", "pending"],
  );
  // DATA_MODEL v1.3: one optional attempt time per notification.
  const n = c.obj(o.notified, `${p}.notified`, [], NOTIFIED_KEYS);
  const notified: Notified = {};
  for (const k of NOTIFIED_KEYS) {
    const t = opt(n, k, (y) => c.time(y, `${p}.notified.${k}`));
    if (t !== undefined) notified[k] = t;
  }
  const current = opt(o, "current", (x) => {
    const q = c.obj(x, `${p}.current`, ["segmentSeq", "tabId", "obsKey", "class", "since"]);
    const obsKey = q.obsKey; // read once (review F1)
    if (typeof obsKey !== "string" || !OBS_KEY.test(obsKey)) c.fail(`${p}.current.obsKey`, "invalid_obs_key");
    return {
      segmentSeq: c.int(q.segmentSeq, `${p}.current.segmentSeq`, 0),
      tabId: c.int(q.tabId, `${p}.current.tabId`),
      obsKey: typeof obsKey === "string" ? obsKey : "",
      class: c.oneOf(q.class, `${p}.current.class`, RELEVANCE_CLASSES),
      since: c.time(q.since, `${p}.current.since`),
    };
  });
  const lastRelevant = opt(o, "lastRelevant", (x) => {
    const q = c.obj(x, `${p}.lastRelevant`, ["tabId", "host", "at"]);
    return {
      tabId: c.int(q.tabId, `${p}.lastRelevant.tabId`),
      host: c.host(q.host, `${p}.lastRelevant.host`),
      at: c.time(q.at, `${p}.lastRelevant.at`),
    };
  });
  const pending = opt(o, "pending", (x) => {
    const pp = `${p}.pending`;
    const q = c.obj(x, pp, ["interventionId", "episodeId", "level", "createdAt", "tabId"], ["attemptedAt", "host"]);
    const attemptedAt = opt(q, "attemptedAt", (y) => c.time(y, `${pp}.attemptedAt`));
    const host = opt(q, "host", (y) => c.host(y, `${pp}.host`));
    return {
      interventionId: c.id(q.interventionId, `${pp}.interventionId`),
      episodeId: c.id(q.episodeId, `${pp}.episodeId`),
      level: c.oneOf(q.level, `${pp}.level`, [1, 2, 3]),
      createdAt: c.time(q.createdAt, `${pp}.createdAt`),
      tabId: c.int(q.tabId, `${pp}.tabId`),
      ...(attemptedAt !== undefined && { attemptedAt }),
      ...(host !== undefined && { host }),
    };
  });
  const d = c.obj(o.drift, `${p}.drift`, ["phase", "since", "accumulatedMs"], ["episodeId"]);
  const episodeId = opt(d, "episodeId", (y) => c.id(y, `${p}.drift.episodeId`));
  const pol = c.obj(
    o.policy,
    `${p}.policy`,
    ["level", "deliveredAt", "sessionCount", "repeatsByEpisode"],
    ["lastDeliveredAt", "mutedUntil"],
  );
  const lastDeliveredAt = opt(pol, "lastDeliveredAt", (y) => c.time(y, `${p}.policy.lastDeliveredAt`));
  const mutedUntil = opt(pol, "mutedUntil", (y) => c.time(y, `${p}.policy.mutedUntil`));
  const value: ActiveState = {
    schemaVersion: c.oneOf(o.schemaVersion, `${p}.schemaVersion`, [1]),
    session: readActiveSession(c, o.session, `${p}.session`),
    lastSeenAt: c.time(o.lastSeenAt, `${p}.lastSeenAt`),
    attention: c.oneOf(o.attention, `${p}.attention`, ATTENTIONS),
    attentionSince: c.time(o.attentionSince, `${p}.attentionSince`),
    awayMs: c.num(o.awayMs, `${p}.awayMs`, { min: 0 }),
    notified,
    drift: {
      phase: c.oneOf(d.phase, `${p}.drift.phase`, DRIFT_PHASES),
      since: c.time(d.since, `${p}.drift.since`),
      accumulatedMs: c.num(d.accumulatedMs, `${p}.drift.accumulatedMs`, { min: 0 }),
      ...(episodeId !== undefined && { episodeId }),
    },
    policy: {
      level: c.oneOf(pol.level, `${p}.policy.level`, [0, 1, 2, 3]),
      deliveredAt: c.arr(pol.deliveredAt, `${p}.policy.deliveredAt`, LIMITS.deliveredAt, (x, ip) => c.time(x, ip)),
      sessionCount: c.int(pol.sessionCount, `${p}.policy.sessionCount`, 0),
      repeatsByEpisode: c.counts(pol.repeatsByEpisode, `${p}.policy.repeatsByEpisode`, isId, LIMITS.repeatsByEpisode),
      ...(lastDeliveredAt !== undefined && { lastDeliveredAt }),
      ...(mutedUntil !== undefined && { mutedUntil }),
    },
    sessionOverrides: c.arr(o.sessionOverrides, `${p}.sessionOverrides`, LIMITS.sessionOverrides, (x, ip) =>
      readOverride(c, x, ip),
    ),
    segSeq: c.int(o.segSeq, `${p}.segSeq`, 0),
    ...(current !== undefined && { current }),
    ...(lastRelevant !== undefined && { lastRelevant }),
    ...(pending !== undefined && { pending }),
  };
  if (value.lastSeenAt < value.session.startedAt) c.fail(`${p}.lastSeenAt`, "before_session_start");
  if (value.attentionSince < value.session.startedAt) c.fail(`${p}.attentionSince`, "before_session_start");
  return c.result(value);
}

function validateSegmentInner(v: unknown): Result<Segment> {
  const c = new Checker();
  const p = "segment";
  const o = c.obj(v, p, ["sessionId", "seq", "start", "class", "reason", "attention"], ["end", "host"]);
  const start = c.time(o.start, `${p}.start`);
  const end = opt(o, "end", (x) => c.time(x, `${p}.end`));
  if (end !== undefined && end < start) c.fail(`${p}.end`, "before_start");
  const host = opt(o, "host", (x) => c.host(x, `${p}.host`));
  const cls = c.oneOf(o.class, `${p}.class`, RELEVANCE_CLASSES);
  const reason = c.oneOf(o.reason, `${p}.reason`, REASON_CODES);
  // Invariant 2: excluded, internal and ephemeral (incognito) segments carry no host.
  if (host !== undefined && (cls === "EXCLUDED" || HOSTLESS_REASONS.includes(reason))) {
    c.fail(`${p}.host`, "forbidden_for_reason");
  }
  return c.result({
    sessionId: c.id(o.sessionId, `${p}.sessionId`),
    seq: c.int(o.seq, `${p}.seq`, 0),
    start,
    class: cls,
    reason,
    attention: c.oneOf(o.attention, `${p}.attention`, SEGMENT_ATTENTIONS),
    ...(end !== undefined && { end }),
    ...(host !== undefined && { host }),
  });
}

// ---- aggregate tier ----

function validateInterventionRecordInner(v: unknown): Result<InterventionRecord> {
  const c = new Checker();
  const p = "intervention";
  // Invariant 4: no host or title field exists, so strictness rejects them.
  const o = c.obj(
    v,
    p,
    ["sessionId", "id", "episodeId", "level", "createdAt", "deliveredVia"],
    ["response", "respondedAt"],
  );
  const response = opt(o, "response", (x) => c.oneOf(x, `${p}.response`, RESPONSES));
  const respondedAt = opt(o, "respondedAt", (x) => c.time(x, `${p}.respondedAt`));
  return c.result({
    sessionId: c.id(o.sessionId, `${p}.sessionId`),
    id: c.id(o.id, `${p}.id`),
    episodeId: c.id(o.episodeId, `${p}.episodeId`),
    level: c.oneOf(o.level, `${p}.level`, [1, 2, 3]),
    createdAt: c.time(o.createdAt, `${p}.createdAt`),
    deliveredVia: c.arr(o.deliveredVia, `${p}.deliveredVia`, DELIVERY_CHANNELS.length, (x, ip) =>
      c.oneOf(x, ip, DELIVERY_CHANNELS),
    ),
    ...(response !== undefined && { response }),
    ...(respondedAt !== undefined && { respondedAt }),
  });
}

function readSummary(c: Checker, v: unknown, p: string): SessionSummary {
  const minuteKeys = [
    "focusedMin",
    "uncertainMin",
    "driftMin",
    "idleMin",
    "awayMin",
    "breakMin",
    "excludedMin",
    "otherMinutes",
  ] as const;
  const o = c.obj(
    v,
    p,
    [...minuteKeys, "driftEpisodes", "recoveries", "interventions", "responses", "relevantHosts"],
    ["objectiveDone"],
  );
  const minutes = (k: (typeof minuteKeys)[number]): number => c.num(o[k], `${p}.${k}`, { min: 0 });
  const objectiveDone = opt(o, "objectiveDone", (x) => c.bool(x, `${p}.objectiveDone`));
  return {
    focusedMin: minutes("focusedMin"),
    uncertainMin: minutes("uncertainMin"),
    driftMin: minutes("driftMin"),
    idleMin: minutes("idleMin"),
    awayMin: minutes("awayMin"),
    breakMin: minutes("breakMin"),
    excludedMin: minutes("excludedMin"),
    otherMinutes: minutes("otherMinutes"),
    driftEpisodes: c.int(o.driftEpisodes, `${p}.driftEpisodes`, 0),
    recoveries: c.int(o.recoveries, `${p}.recoveries`, 0),
    interventions: c.int(o.interventions, `${p}.interventions`, 0),
    responses: c.counts(o.responses, `${p}.responses`, isResponse),
    relevantHosts: c.arr(o.relevantHosts, `${p}.relevantHosts`, LIMITS.relevantHosts, (x, ip) => {
      const h = c.obj(x, ip, ["host", "minutes"]);
      return { host: c.host(h.host, `${ip}.host`), minutes: c.num(h.minutes, `${ip}.minutes`, { min: 0 }) };
    }),
    ...(objectiveDone !== undefined && { objectiveDone }),
  };
}

function validateSessionRecordInner(v: unknown): Result<SessionRecord> {
  const c = new Checker();
  const p = "sessionRecord";
  const o = c.obj(v, p, [
    "id",
    "startedAt",
    "endedAt",
    "endReason",
    "taskLabel",
    "objective",
    "mode",
    "plannedMin",
    "actualMin",
    "summary",
  ]);
  const startedAt = c.time(o.startedAt, `${p}.startedAt`);
  const endedAt = c.time(o.endedAt, `${p}.endedAt`);
  if (endedAt < startedAt) c.fail(`${p}.endedAt`, "before_start");
  return c.result({
    id: c.id(o.id, `${p}.id`),
    startedAt,
    endedAt,
    endReason: c.oneOf(o.endReason, `${p}.endReason`, END_REASONS),
    taskLabel: c.str(o.taskLabel, `${p}.taskLabel`, LIMITS.taskLabel, 1),
    objective: c.str(o.objective, `${p}.objective`, LIMITS.objective),
    mode: c.oneOf(o.mode, `${p}.mode`, MODES),
    plannedMin: c.int(o.plannedMin, `${p}.plannedMin`, 0),
    actualMin: c.num(o.actualMin, `${p}.actualMin`, { min: 0 }),
    summary: readSummary(c, o.summary, `${p}.summary`),
  });
}

// ---- system ----

function validateMetaInner(v: unknown): Result<Meta> {
  const c = new Checker();
  const o = c.obj(v, "meta", ["schemaVersion", "installedAt"]);
  return c.result({
    schemaVersion: c.oneOf(o.schemaVersion, "meta.schemaVersion", [1]),
    installedAt: c.time(o.installedAt, "meta.installedAt"),
  });
}

/** Diag codes (DATA_MODEL §8). */
export const DIAG_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;

function validateDiagEntryInner(v: unknown): Result<DiagEntry> {
  const c = new Checker();
  const o = c.obj(v, "diag", ["at", "code"]);
  const code = c.str(o.code, "diag.code", 41);
  if (!DIAG_CODE.test(code)) c.fail("diag.code", "invalid_code");
  return c.result({ at: c.time(o.at, "diag.at"), code });
}

/**
 * Per-field read of stored preferences (DATA_MODEL §5, §8, AC-15). Each top-level
 * field that is missing or invalid falls back to its default and is listed in
 * `resetFields`. Unknown fields are dropped and listed as `unknown:<key>`.
 * `undefined` (nothing stored yet) gives the defaults with no resets; any other
 * non-object gives the defaults with every field listed.
 */
function parsePreferencesInner(raw: unknown): { prefs: Preferences; resetFields: string[] } {
  const defaults = defaultPreferences();
  if (raw === undefined) return { prefs: defaults, resetFields: [] };
  if (!isPlainObject(raw)) return { prefs: defaults, resetFields: [...PREF_KEYS] };
  const resetFields: string[] = [];
  const prefs = buildPreferences((k) => {
    if (!Object.hasOwn(raw, k) || raw[k] === undefined) {
      resetFields.push(k);
      return defaults[k];
    }
    const c = new Checker();
    const value = PREF_PARSERS[k](raw[k], c, k);
    if (c.errors.length > 0) {
      resetFields.push(k);
      return defaults[k];
    }
    return value;
  });
  for (const k of Object.keys(raw)) {
    if (!PREF_KEYS.some((known) => known === k)) resetFields.push(`unknown:${safeKey(k)}`);
  }
  return { prefs, resetFields };
}

// ---- exported entry points: validate a read-once snapshot, never the input (review F1) ----

function guarded<T>(root: string, inner: (v: unknown) => Result<T>): (v: unknown) => Result<T> {
  return (v) => {
    const snap = trySnapshot(v);
    return snap.ok ? inner(snap.value) : { ok: false, errors: [`${root}:not_cloneable`] };
  };
}

export const validatePreferences: (v: unknown) => Result<Preferences> = guarded("prefs", validatePreferencesInner);
export const validateOverride: (v: unknown) => Result<Override> = guarded("override", validateOverrideInner);
export const validateSessionConfig: (v: unknown) => Result<SessionConfig> = guarded(
  "config",
  validateSessionConfigInner,
);
export const validateActiveState: (v: unknown) => Result<ActiveState> = guarded("active", validateActiveStateInner);
export const validateSegment: (v: unknown) => Result<Segment> = guarded("segment", validateSegmentInner);
export const validateInterventionRecord: (v: unknown) => Result<InterventionRecord> = guarded(
  "intervention",
  validateInterventionRecordInner,
);
export const validateSessionRecord: (v: unknown) => Result<SessionRecord> = guarded(
  "sessionRecord",
  validateSessionRecordInner,
);
export const validateMeta: (v: unknown) => Result<Meta> = guarded("meta", validateMetaInner);
export const validateDiagEntry: (v: unknown) => Result<DiagEntry> = guarded("diag", validateDiagEntryInner);

/** Per-field read of stored preferences (see parsePreferencesInner). Input that isn't plain data counts as a non-object. */
export function parsePreferences(raw: unknown): { prefs: Preferences; resetFields: string[] } {
  const snap = trySnapshot(raw);
  return parsePreferencesInner(snap.ok ? snap.value : null);
}
