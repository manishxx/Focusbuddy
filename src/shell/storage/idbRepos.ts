/**
 * Repositories over IndexedDB `fb` (DATA_MODEL §7, §8). Writes are validated
 * strictly; rows read back are validated too, and invalid rows are skipped and
 * counted in diag (never returned, never thrown to the UI).
 */
import {
  isPlainObject,
  validateInterventionRecord,
  validateSegment,
  validateSessionRecord,
} from "../../core/storage/validate";
import type { InterventionRecord, Segment, SessionRecord } from "../../core/types";
import {
  INDEX_BY_ENDED_AT,
  INDEX_BY_SESSION,
  type KeyRangeApi,
  runTx,
  STORE_INTERVENTIONS,
  STORE_SEGMENTS,
  STORE_SESSIONS,
} from "./idb";
import type { InvalidSink, WriteResult } from "./kvRepos";

/** Invariant 6: at most this many segments per session. */
export const SEGMENT_CAP = 5_000;
export const SESSION_LIST_MAX = 50;

export type IdbRepoDeps = { db: IDBDatabase; keyRange: KeyRangeApi; onInvalid: InvalidSink };

const sessionSegments = (keyRange: KeyRangeApi, sessionId: string): IDBKeyRange =>
  keyRange.bound([sessionId, 0], [sessionId, Number.POSITIVE_INFINITY]);

// ---- segments (raw tier) ----

export type AppendOutcome = "appended" | "extended" | "dropped";

export interface SegmentsRepo {
  /** At the cap, extends the last segment's end instead of inserting (invariant 6). */
  append(segment: unknown): Promise<WriteResult & { outcome?: AppendOutcome }>;
  /** Sets `end` on the session's last segment if it is still open. True if it closed one. */
  closeLast(sessionId: string, end: number): Promise<boolean>;
  listForSession(sessionId: string): Promise<Segment[]>;
  deleteForSession(sessionId: string): Promise<void>;
  clearAll(): Promise<void>;
  count(sessionId: string): Promise<number>;
}

export function segmentsRepo(deps: IdbRepoDeps, cap: number = SEGMENT_CAP): SegmentsRepo {
  const { db, keyRange, onInvalid } = deps;
  return {
    async append(segment) {
      const r = validateSegment(segment);
      if (!r.ok) return r;
      const seg = r.value;
      let invalid = 0;
      const outcome = await runTx(db, STORE_SEGMENTS, "readwrite", (tx) => {
        const store = tx.objectStore(STORE_SEGMENTS);
        const range = sessionSegments(keyRange, seg.sessionId);
        let result: AppendOutcome = "appended";
        const countReq = store.count(range);
        countReq.onsuccess = () => {
          if (countReq.result < cap) {
            store.put(seg);
            return;
          }
          const cursorReq = store.openCursor(range, "prev");
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor === null) {
              store.put(seg);
              return;
            }
            const last = validateSegment(cursor.value);
            if (!last.ok) {
              invalid += 1;
              result = "dropped";
              return;
            }
            const extended: Segment = { ...last.value };
            if (seg.end === undefined) delete extended.end;
            else extended.end = Math.max(extended.end ?? seg.end, seg.end);
            cursor.update(extended);
            result = "extended";
          };
        };
        return () => result;
      });
      await onInvalid("E_INVALID_SEGMENT_ROW", invalid);
      return { ok: true, outcome };
    },

    async closeLast(sessionId, end) {
      if (!Number.isFinite(end) || end < 0) return false;
      let invalid = 0;
      const closed = await runTx(db, STORE_SEGMENTS, "readwrite", (tx) => {
        let done = false;
        const cursorReq = tx.objectStore(STORE_SEGMENTS).openCursor(sessionSegments(keyRange, sessionId), "prev");
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor === null) return;
          const last = validateSegment(cursor.value);
          if (!last.ok) {
            invalid += 1;
            return;
          }
          if (last.value.end !== undefined || end < last.value.start) return;
          cursor.update({ ...last.value, end });
          done = true;
        };
        return () => done;
      });
      await onInvalid("E_INVALID_SEGMENT_ROW", invalid);
      return closed;
    },

    async listForSession(sessionId) {
      const rows = await runTx(db, STORE_SEGMENTS, "readonly", (tx) => {
        const req = tx.objectStore(STORE_SEGMENTS).getAll(sessionSegments(keyRange, sessionId));
        return (): unknown[] => req.result;
      });
      return keepValid(rows, validateSegment, onInvalid, "E_INVALID_SEGMENT_ROW");
    },

    deleteForSession: (sessionId) =>
      runTx(db, STORE_SEGMENTS, "readwrite", (tx) => {
        tx.objectStore(STORE_SEGMENTS).delete(sessionSegments(keyRange, sessionId));
        return () => undefined;
      }),

    clearAll: () =>
      runTx(db, STORE_SEGMENTS, "readwrite", (tx) => {
        tx.objectStore(STORE_SEGMENTS).clear();
        return () => undefined;
      }),

    count: (sessionId) =>
      runTx(db, STORE_SEGMENTS, "readonly", (tx) => {
        const req = tx.objectStore(STORE_SEGMENTS).count(sessionSegments(keyRange, sessionId));
        return () => req.result;
      }),
  };
}

async function keepValid<T>(
  rows: readonly unknown[],
  validate: (v: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
  onInvalid: InvalidSink,
  code: string,
): Promise<T[]> {
  const out: T[] = [];
  let invalid = 0;
  for (const row of rows) {
    const r = validate(row);
    if (r.ok) out.push(r.value);
    else invalid += 1;
  }
  await onInvalid(code, invalid);
  return out;
}

// ---- interventions (aggregate tier) ----

export interface InterventionsRepo {
  put(record: unknown): Promise<WriteResult>;
  listForSession(sessionId: string): Promise<InterventionRecord[]>;
  deleteForSession(sessionId: string): Promise<void>;
}

/** Deletes every intervention of `sessionId` inside an open transaction. */
function deleteInterventionsIn(tx: IDBTransaction, sessionId: string): void {
  const store = tx.objectStore(STORE_INTERVENTIONS);
  const keysReq = store.index(INDEX_BY_SESSION).getAllKeys(sessionId);
  keysReq.onsuccess = () => {
    for (const key of keysReq.result) store.delete(key);
  };
}

export function interventionsRepo(deps: IdbRepoDeps): InterventionsRepo {
  const { db, onInvalid } = deps;
  return {
    async put(record) {
      const r = validateInterventionRecord(record);
      if (!r.ok) return r;
      await runTx(db, STORE_INTERVENTIONS, "readwrite", (tx) => {
        tx.objectStore(STORE_INTERVENTIONS).put(r.value);
        return () => undefined;
      });
      return { ok: true };
    },
    async listForSession(sessionId) {
      const rows = await runTx(db, STORE_INTERVENTIONS, "readonly", (tx) => {
        const req = tx.objectStore(STORE_INTERVENTIONS).index(INDEX_BY_SESSION).getAll(sessionId);
        return (): unknown[] => req.result;
      });
      return keepValid(rows, validateInterventionRecord, onInvalid, "E_INVALID_INTERVENTION_ROW");
    },
    deleteForSession: (sessionId) =>
      runTx(db, STORE_INTERVENTIONS, "readwrite", (tx) => {
        deleteInterventionsIn(tx, sessionId);
        return () => undefined;
      }),
  };
}

// ---- sessions (aggregate tier) ----

export type PruneResult = { sessions: number; orphanInterventions: number };

export interface SessionsRepo {
  put(record: unknown): Promise<WriteResult>;
  /** null when absent or invalid. */
  get(id: string): Promise<SessionRecord | null>;
  /** Newest first by endedAt; `before` pages by endedAt (exclusive); limit 1–50. */
  list(options?: { limit?: number; before?: number }): Promise<SessionRecord[]>;
  /** Deletes the session and its interventions in one transaction. */
  delete(id: string): Promise<void>;
  /**
   * Deletes sessions with endedAt < cut-off and their interventions, in one
   * transaction. A cut-off of +Infinity (retention 0) clears both stores. Also
   * deletes orphaned interventions (no session record) created before the cut-off.
   */
  pruneOlderThan(cut: number): Promise<PruneResult>;
}

export function sessionsRepo(deps: IdbRepoDeps): SessionsRepo {
  const { db, keyRange, onInvalid } = deps;
  const both = [STORE_SESSIONS, STORE_INTERVENTIONS];
  return {
    async put(record) {
      const r = validateSessionRecord(record);
      if (!r.ok) return r;
      await runTx(db, STORE_SESSIONS, "readwrite", (tx) => {
        tx.objectStore(STORE_SESSIONS).put(r.value);
        return () => undefined;
      });
      return { ok: true };
    },

    async get(id) {
      const row = await runTx(db, STORE_SESSIONS, "readonly", (tx) => {
        const req = tx.objectStore(STORE_SESSIONS).get(id);
        return (): unknown => req.result;
      });
      if (row === undefined) return null;
      const r = validateSessionRecord(row);
      if (r.ok) return r.value;
      await onInvalid("E_INVALID_SESSION_ROW", 1);
      return null;
    },

    async list(options = {}) {
      const requested = options.limit ?? SESSION_LIST_MAX;
      const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), SESSION_LIST_MAX) : SESSION_LIST_MAX;
      const before = options.before;
      let invalid = 0;
      const out = await runTx(db, STORE_SESSIONS, "readonly", (tx) => {
        const found: SessionRecord[] = [];
        const range = before !== undefined && Number.isFinite(before) ? keyRange.upperBound(before, true) : null;
        const cursorReq = tx.objectStore(STORE_SESSIONS).index(INDEX_BY_ENDED_AT).openCursor(range, "prev");
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor === null) return;
          const r = validateSessionRecord(cursor.value);
          if (r.ok) found.push(r.value);
          else invalid += 1;
          if (found.length < limit) cursor.continue();
        };
        return () => found;
      });
      await onInvalid("E_INVALID_SESSION_ROW", invalid);
      return out;
    },

    delete: (id) =>
      runTx(db, both, "readwrite", (tx) => {
        tx.objectStore(STORE_SESSIONS).delete(id);
        deleteInterventionsIn(tx, id);
        return () => undefined;
      }),

    pruneOlderThan: (cut) =>
      runTx(db, both, "readwrite", (tx) => {
        const sessions = tx.objectStore(STORE_SESSIONS);
        const interventions = tx.objectStore(STORE_INTERVENTIONS);
        const result: PruneResult = { sessions: 0, orphanInterventions: 0 };
        if (cut === Number.POSITIVE_INFINITY) {
          // retentionDays = 0: keep nothing, including rows the index can't see.
          const countReq = sessions.count();
          countReq.onsuccess = () => {
            result.sessions = countReq.result;
          };
          sessions.clear();
          interventions.clear();
          return () => result;
        }
        if (Number.isNaN(cut)) return () => result;
        // Interventions whose session never got a record (ended without a summary).
        // Runs after the expired sessions and their interventions are deleted.
        const scanOrphans = (): void => {
          const orphanReq = interventions.openCursor();
          orphanReq.onsuccess = () => {
            const cursor = orphanReq.result;
            if (cursor === null) return;
            const row: unknown = cursor.value;
            const sessionId = isPlainObject(row) ? row.sessionId : undefined;
            const createdAt = isPlainObject(row) ? row.createdAt : undefined;
            if (typeof sessionId !== "string" || typeof createdAt !== "number" || !(createdAt < cut)) {
              cursor.continue();
              return;
            }
            const existsReq = sessions.getKey(sessionId);
            existsReq.onsuccess = () => {
              if (existsReq.result === undefined) {
                cursor.delete();
                result.orphanInterventions += 1;
              }
              cursor.continue();
            };
          };
        };
        const cursorReq = sessions.index(INDEX_BY_ENDED_AT).openCursor(keyRange.upperBound(cut, true));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor === null) {
            scanOrphans();
            return;
          }
          const key = cursor.primaryKey;
          if (typeof key === "string") deleteInterventionsIn(tx, key);
          cursor.delete();
          result.sessions += 1;
          cursor.continue();
        };
        return () => result;
      }),
  };
}
