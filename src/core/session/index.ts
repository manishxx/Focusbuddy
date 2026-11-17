/** Session state machine (ARCHITECTURE §5.1, §5.1.1): pure reducer, time math, snapshot, summary. */
export { reduceSession, ALARM_SLACK_MS, START_REPEAT_WINDOW_MS } from "./reducer";
export { buildSnapshot, snapshotKey } from "./snapshot";
export type { Notice, NoticeCode, SnapshotSession, UiSnapshot } from "./snapshot";
export { buildSessionRecord } from "./summary";
export { elapsedMs, endsAt, remainingMs, totalMs, openPause, naturalEndAt, pausedMs } from "./time";
export { ALARM_NAMES, BADGE_COLORS, alarmsFor, notificationIds, presentation } from "./present";
export { SESSION_COMMAND_TYPES } from "./types";
export type {
  AlarmName,
  Effect,
  ErrorCode,
  FxVar,
  FxVars,
  IdleStateName,
  ReduceContext,
  ReduceResult,
  SessionCommand,
  SessionCommandType,
  SessionDraft,
  SessionInput,
  StartupInput,
} from "./types";
