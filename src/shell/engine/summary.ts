/**
 * BuildSummaryAndPurgeRaw (DATA_MODEL §4, ARCHITECTURE §5.1.1 ENDING row).
 * Idempotent for crash recovery: an existing SessionRecord is never rebuilt, raw
 * rows (segments) are deleted if present, session.active is removed. Interventions
 * are aggregate data and stay with their SessionRecord (D-022, DATA_MODEL §1). Steps run in order; a
 * failure stops the run and leaves session.active in ENDING, so the next start
 * finishes it. Safe mode (no IndexedDB): no summary is possible, so the session
 * is closed without one (session.active removed; the start-up raw purge clears
 * segments once no valid session.active exists).
 */
import { buildSessionRecord } from "../../core/session";
import type { ActiveState, EndReason } from "../../core/types";
import { errorCode } from "../storage/idb";
import type { SegmentsRepo, SessionsRepo } from "../storage/idbRepos";
import type { ActiveRepo } from "../storage/kvRepos";
import { STORAGE_DELETED } from "../storage/kvLock";

export type SummaryRepos = {
  active: ActiveRepo;
  sessions: SessionsRepo | null;
  segments: SegmentsRepo | null;
};

export type SummaryOutcome = {
  /** Set when a SessionRecord for the session exists afterwards. */
  summaryId?: string;
  /** Diag codes (error codes only). */
  codes: string[];
  /** True when every step completed (session.active removed). */
  done: boolean;
};

export async function buildSummaryAndPurgeRaw(
  state: ActiveState | null,
  effect: { sessionId: string; endReason: EndReason; endedAt: number },
  repos: SummaryRepos,
): Promise<SummaryOutcome> {
  const codes: string[] = [];
  const id = effect.sessionId;
  let step = "E_SUMMARY_READ";
  try {
    if (repos.sessions === null) {
      codes.push("E_SUMMARY_SAFE_MODE");
      step = "E_SUMMARY_ACTIVE_REMOVE";
      await repos.active.remove();
      return { codes, done: true };
    }
    let summaryId: string | undefined;
    const existing = await repos.sessions.get(id);
    if (existing !== null) summaryId = id;
    else if (state !== null && state.session.id === id) {
      step = "E_SUMMARY_WRITE";
      const written = await repos.sessions.put(buildSessionRecord(state, effect.endReason, effect.endedAt));
      if (written.ok) summaryId = id;
      else codes.push("E_SUMMARY_INVALID");
    } else codes.push("E_SUMMARY_NO_STATE");
    step = "E_SUMMARY_PURGE";
    await repos.segments?.deleteForSession(id);
    step = "E_SUMMARY_ACTIVE_REMOVE";
    await repos.active.remove();
    return { ...(summaryId !== undefined && { summaryId }), codes, done: true };
  } catch (error) {
    // "Data was deleted" (DATA_MODEL §8.1) is not a failure worth a diag entry.
    if (errorCode(error, "") !== STORAGE_DELETED) codes.push(errorCode(error, step));
    return { codes, done: false };
  }
}
