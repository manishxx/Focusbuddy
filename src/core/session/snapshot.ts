/**
 * UiSnapshot builder (API_CONTRACTS §6). Day 07 has no drift, interventions,
 * recovery or context label yet: status is "on_task" and those fields are omitted.
 * The snapshot never carries titles or URLs.
 */
import type { ActiveState, Attention, Mode } from "../types";
import { endsAt, openPause } from "./time";

export type NoticeCode =
  | "notifications_unavailable"
  | "overlay_permission_missing"
  | "overlay_unavailable_page"
  | "storage_error"
  | "prefs_reset"
  | "safe_mode";

export type Notice = { code: NoticeCode; at: number };

export type SnapshotSession = {
  id: string;
  state: "ACTIVE" | "PAUSED" | "ON_BREAK" | "ENDING";
  awaitingContinue: boolean;
  awaySince?: number;
  taskLabel: string;
  objective: string;
  nextStep?: string;
  plannedMin: number;
  endsAt: number;
  pausedAt?: number;
  breakEndsAt?: number;
  mode: Mode;
  attention: Attention;
  status: "on_task" | "unsure" | "drift_pending" | "drifted" | "recovering" | "excluded";
  mutedUntil?: number;
};

export type UiSnapshot = {
  v: 1;
  at: number;
  session: null | SnapshotSession;
  notices: Notice[];
  lastSummaryId?: string;
};

/**
 * `session` is null with no state and for ENDING: the summary is built in the same
 * input, so by the time pages see the snapshot the session has ended (§5.1.1 ENDING row).
 */
export function buildSnapshot(
  state: ActiveState | null,
  notices: readonly Notice[],
  lastSummaryId: string | undefined,
  at: number,
): UiSnapshot {
  const base = {
    v: 1 as const,
    at,
    notices: notices.map((n) => ({ code: n.code, at: n.at })),
    ...(lastSummaryId !== undefined && { lastSummaryId }),
  };
  if (state === null || state.session.state === "ENDING") return { ...base, session: null };
  const s = state.session;
  const open = openPause(s);
  const session: SnapshotSession = {
    id: s.id,
    state: s.state,
    awaitingContinue: s.awaitingContinue === true,
    taskLabel: s.taskLabel,
    objective: s.objective,
    plannedMin: s.plannedMin,
    endsAt: endsAt(s, at),
    mode: s.mode,
    attention: state.attention,
    status: "on_task",
    ...(s.awaySince !== undefined && { awaySince: s.awaySince }),
    ...(s.nextStep !== undefined && { nextStep: s.nextStep }),
    ...(s.state === "PAUSED" && open !== undefined && { pausedAt: open.from }),
    ...(s.state === "ON_BREAK" && s.breakEndsAt !== undefined && { breakEndsAt: s.breakEndsAt }),
    ...(state.policy.mutedUntil !== undefined && { mutedUntil: state.policy.mutedUntil }),
  };
  return { ...base, session };
}

/** Snapshot content without `at`, for "publish only when content changes" (§6). */
export function snapshotKey(s: UiSnapshot): string {
  return JSON.stringify({ ...s, at: 0 });
}
