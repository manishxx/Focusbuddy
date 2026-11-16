/**
 * Shared domain types for the core (ARCHITECTURE §3).
 * Persisted record shapes follow docs/DATA_MODEL.md §2 (v1.2). The validators in
 * ./storage/validate.ts are the runtime counterpart of these types.
 */

/** Epoch milliseconds, as returned by Clock.now(). */
export type EpochMs = number;

export type Mode = "gentle" | "adaptive" | "strict";

// ---- settings tier ----

export type Preferences = {
  schemaVersion: 1;
  defaultMode: Mode;
  /** 60–600, default 90 */
  driftThresholdSec: number;
  /** 10–120, default 20 */
  recoveryThresholdSec: number;
  /** 15–1800, default 300 */
  idleThresholdSec: number;
  /** defaults 15/10/5, minimums 10/5/3 */
  cooldownMin: { gentle: number; adaptive: number; strict: number };
  /** 1–6, default 4 */
  maxPerHour: number;
  /** 1–30, default 12 */
  maxPerSession: number;
  sound: { enabled: boolean; tone: SoundTone; volume: number };
  notificationsEnabled: boolean;
  notificationsSeen: null | boolean;
  shortcutMuteMin: 15 | 60 | -1;
  privateNotifications: boolean;
  overlay: { enabled: boolean; countdownSec: 5 | 6 | 7 | 8 | 9 | 10; showTaskLabel: boolean };
  /** Device local time "HH:MM"; may cross midnight. */
  quietHours: null | { start: string; end: string };
  incognitoMonitoring: boolean;
  /** hosts, ≤ 200 */
  userExclusions: string[];
  /** 0–90, default 30; 0 = keep nothing */
  retentionDays: number;
  ai: { enabled: false; provider: "none" | "mock" };
  onboardingDone: boolean;
};

export type SoundTone = "chime" | "soft" | "bell";

export type Override = { host: string; titleSubstring?: string; createdAt: number };

// ---- raw tier (session life only; storage.local) ----

export type SessionState = "ACTIVE" | "PAUSED" | "ON_BREAK" | "ENDING";

export type Attention = "ACTIVE_INPUT" | "IDLE" | "LOCKED" | "BROWSER_UNFOCUSED";

export type PauseKind = "pause" | "break" | "auto_absent";

export type DriftPhase = "ON_TASK" | "DRIFT_PENDING" | "DRIFTED" | "RECOVERING";

export type InterventionLevel = 1 | 2 | 3;

export type SessionConfig = {
  /** ≤ 120 */
  taskLabel: string;
  /** ≤ 300 */
  objective: string;
  /** ≤ 500 */
  nextStep?: string;
  /** ≤ 50, normalised (lowercase, no www.) */
  allowedHosts: string[];
  /** ≤ 40 */
  keywords: string[];
  mode: Mode;
};

export type ActiveSession = SessionConfig & {
  id: string;
  state: SessionState;
  startedAt: number;
  plannedMin: number;
  extensionsMin: number;
  pauses: Array<{ from: number; to?: number; kind: PauseKind }>;
  breakEndsAt?: number;
  ending?: { endReason: EndReason; endedAt: number };
  awaitingContinue?: boolean;
  awaySince?: number;
};

export type ActiveState = {
  schemaVersion: 1;
  session: ActiveSession;
  lastSeenAt: number;
  attention: Attention;
  current?: { segmentSeq: number; tabId: number; obsKey: string; class: RelevanceClass; since: number };
  drift: { phase: DriftPhase; since: number; accumulatedMs: number; episodeId?: string };
  lastRelevant?: { tabId: number; host: string; at: number };
  policy: {
    level: 0 | 1 | 2 | 3;
    lastDeliveredAt?: number;
    deliveredAt: number[];
    sessionCount: number;
    repeatsByEpisode: Record<string, number>;
    mutedUntil?: number;
  };
  pending?: {
    interventionId: string;
    episodeId: string;
    level: InterventionLevel;
    createdAt: number;
    attemptedAt?: number;
    tabId: number;
    host?: string;
  };
  sessionOverrides: Override[];
  segSeq: number;
};

export type EndReason = "time_up" | "user_stop" | "expired_while_closed" | "stale_pause" | "deleted_all";

export type SegmentAttention = Attention | "AWAY";

/** IndexedDB "segments" (raw tier). NO title, NO path, NO URL, ever. */
export type Segment = {
  sessionId: string;
  seq: number;
  start: number;
  end?: number;
  /** absent if EXCLUDED, internal or ephemeral (incognito) */
  host?: string;
  class: RelevanceClass;
  reason: ReasonCode;
  attention: SegmentAttention;
};

// ---- aggregate tier (kept for retentionDays) ----

export type DeliveryChannel = "badge" | "panel" | "notification" | "sound" | "overlay" | "page";

export type InterventionResponse =
  "back" | "relevant" | "break" | "mute" | "stop" | "continue" | "dismissed" | "ignored";

/** No hosts, no titles. */
export type InterventionRecord = {
  sessionId: string;
  id: string;
  episodeId: string;
  level: InterventionLevel;
  createdAt: number;
  deliveredVia: DeliveryChannel[];
  response?: InterventionResponse;
  respondedAt?: number;
};

export type SessionSummary = {
  focusedMin: number;
  uncertainMin: number;
  driftMin: number;
  idleMin: number;
  awayMin: number;
  breakMin: number;
  excludedMin: number;
  driftEpisodes: number;
  recoveries: number;
  interventions: number;
  responses: Record<string, number>;
  /** ≤ 10; RELEVANT hosts only */
  relevantHosts: Array<{ host: string; minutes: number }>;
  otherMinutes: number;
  objectiveDone?: boolean;
};

export type SessionRecord = {
  id: string;
  startedAt: number;
  endedAt: number;
  endReason: EndReason;
  taskLabel: string;
  objective: string;
  mode: Mode;
  plannedMin: number;
  actualMin: number;
  summary: SessionSummary;
};

export type RelevanceClass = "RELEVANT" | "UNCERTAIN" | "LIKELY_IRRELEVANT" | "EXCLUDED";

export type ReasonCode =
  | "excluded"
  | "internal"
  | "placeholder"
  | "override"
  | "allowed_host"
  | "keyword"
  | "distraction_rule"
  | "mixed_use_no_match"
  | "not_allowed_no_match"
  | "ai"
  | "ephemeral";

// ---- system ----

export type Meta = { schemaVersion: 1; installedAt: number };

/** Diagnostic entry: an error code only, never user data. */
export type DiagEntry = { at: number; code: string };
