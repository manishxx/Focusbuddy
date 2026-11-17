/**
 * Inputs, effects and results of the session reducer (ARCHITECTURE §4, §5.1.1).
 * Effects are plain data: the shell's effect runner turns them into chrome calls.
 */
import type { MessageKey } from "../messages";
import type { ActiveState, EndReason, Mode, Segment } from "../types";

/** Error codes from API_CONTRACTS §1 (plus the two the Day 07 brief names, see the report). */
export type ErrorCode =
  | "invalid_message"
  | "unknown_type"
  | "forbidden_sender"
  | "invalid_state"
  | "not_found"
  | "permission_missing"
  | "storage_error"
  | "internal"
  | "invalid_argument"
  | "not_implemented";

/** API_CONTRACTS §3 `session.start` payload. Mode falls back to prefs.defaultMode. */
export type SessionDraft = {
  taskLabel: string;
  objective: string;
  nextStep?: string;
  allowedHosts: string[];
  keywords: string[];
  plannedMin: number;
  mode?: Mode;
};

export type SessionCommandType =
  | "session.start"
  | "session.pause"
  | "session.resume"
  | "session.continue"
  | "session.extend"
  | "session.stop"
  | "session.updateNote"
  | "break.start"
  | "break.end"
  | "break.extend";

export const SESSION_COMMAND_TYPES: readonly SessionCommandType[] = [
  "session.start",
  "session.pause",
  "session.resume",
  "session.continue",
  "session.extend",
  "session.stop",
  "session.updateNote",
  "break.start",
  "break.end",
  "break.extend",
];

/** The payload is untrusted; the reducer validates it per type. */
export type SessionCommand = { type: SessionCommandType; payload: unknown };

export type IdleStateName = "active" | "idle" | "locked";

export type SessionInput =
  | { kind: "command"; command: SessionCommand }
  | { kind: "alarm"; name: string }
  | { kind: "idle"; state: IdleStateName; at: number }
  | { kind: "tick" }
  /** Reconciliation (§4, §5.1.1). */
  | StartupInput;

/**
 * `corrupt`: session.active exists but is invalid. The engine reads the notification
 * state for the reducer: `startShown` (is fb.start.<id> showing? undefined = unknown,
 * treated as shown) and `shownNotificationIds` (every notification currently shown).
 */
export type StartupInput = {
  kind: "startup";
  corrupt?: boolean;
  /** Storage is in safe mode (DATA_MODEL §5): monitoring is disabled, any session is ended. */
  safeMode?: boolean;
  startShown?: boolean;
  shownNotificationIds?: readonly string[];
};

export type ReduceContext = {
  now: number;
  privateNotifications: boolean;
  defaultMode: Mode;
  /** Random id source; must match ^[A-Za-z0-9_-]{1,64}$ (DATA_MODEL §8.1). */
  newId: () => string;
};

/** A message-bank placeholder value. Clock times and durations are formatted by the shell. */
export type FxVar = string | number | { kind: "clock"; at: number } | { kind: "duration"; ms: number };
export type FxVars = Readonly<Record<string, FxVar>>;

export type AlarmName = "fb.tick" | "fb.sessionEnd" | "fb.breakEnd" | "fb.breakPrompt" | "fb.stalePause";

export type Effect =
  | { type: "ScheduleAlarm"; name: AlarmName; when?: number; periodMin?: number }
  | { type: "ClearAlarm"; name: AlarmName }
  | {
      type: "ShowNotification";
      id: string;
      titleKey: MessageKey;
      bodyKey: MessageKey;
      vars: FxVars;
      generic: boolean;
    }
  | { type: "ClearNotification"; id: string }
  | { type: "SetBadge"; text: string; color?: string }
  | { type: "SetActionTitle"; key: MessageKey; vars: FxVars }
  | { type: "PublishSnapshot" }
  | { type: "BuildSummaryAndPurgeRaw"; sessionId: string; endReason: EndReason; endedAt: number }
  /** Not emitted on Day 07 (Day 09 observation); the runner already handles it idempotently. */
  | { type: "AppendSegment"; segment: Segment }
  /** A diagnostic code (error codes only, ARCHITECTURE §10). */
  | { type: "Diag"; code: string };

export type ReduceResult = {
  state: ActiveState | null;
  effects: Effect[];
  error?: ErrorCode;
  /** Reply data for commands (e.g. `{sessionId}`, or `{activeSessionId}` with invalid_state). */
  data?: Readonly<Record<string, unknown>>;
};
