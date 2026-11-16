// Shared fixtures for the storage tests (DATA_MODEL §2 shapes).
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { ActiveState, InterventionRecord, Segment, SessionRecord } from "../../../src/core/types";
import type { KeyRangeApi } from "../../../src/shell/storage/idb";

export const keyRange: KeyRangeApi = IDBKeyRange;

/** A fresh, empty fake IndexedDB per test (never the global auto shim). */
export function freshFactory(): IDBFactory {
  return new IDBFactory();
}

export function segment(over: Partial<Segment> = {}): Segment {
  return {
    sessionId: "s1",
    seq: 0,
    start: 1_000,
    end: 2_000,
    host: "docs.example.com",
    class: "RELEVANT",
    reason: "allowed_host",
    attention: "ACTIVE_INPUT",
    ...over,
  };
}

export function intervention(over: Partial<InterventionRecord> = {}): InterventionRecord {
  return {
    sessionId: "s1",
    id: "i1",
    episodeId: "e1",
    level: 1,
    createdAt: 5_000,
    deliveredVia: ["badge", "panel"],
    ...over,
  };
}

export function sessionRecord(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s1",
    startedAt: 1_000,
    endedAt: 61_000,
    endReason: "time_up",
    taskLabel: "Write report",
    objective: "Finish the draft",
    mode: "gentle",
    plannedMin: 60,
    actualMin: 1,
    summary: {
      focusedMin: 1,
      uncertainMin: 0,
      driftMin: 0,
      idleMin: 0,
      awayMin: 0,
      breakMin: 0,
      excludedMin: 0,
      driftEpisodes: 0,
      recoveries: 0,
      interventions: 0,
      responses: { back: 1 },
      relevantHosts: [{ host: "docs.example.com", minutes: 1 }],
      otherMinutes: 0,
    },
    ...over,
  };
}

export function activeState(over: Partial<ActiveState> = {}): ActiveState {
  return {
    schemaVersion: 1,
    session: {
      taskLabel: "Write report",
      objective: "Finish the draft",
      nextStep: "Outline section 2",
      allowedHosts: ["docs.example.com"],
      keywords: ["report"],
      mode: "adaptive",
      id: "s1",
      state: "ACTIVE",
      startedAt: 1_000,
      plannedMin: 60,
      extensionsMin: 0,
      pauses: [{ from: 2_000, to: 3_000, kind: "pause" }],
    },
    lastSeenAt: 4_000,
    attention: "ACTIVE_INPUT",
    current: { segmentSeq: 0, tabId: 7, obsKey: "h:abc123", class: "RELEVANT", since: 1_000 },
    drift: { phase: "ON_TASK", since: 1_000, accumulatedMs: 0 },
    lastRelevant: { tabId: 7, host: "docs.example.com", at: 1_000 },
    policy: { level: 0, deliveredAt: [], sessionCount: 0, repeatsByEpisode: {} },
    sessionOverrides: [],
    segSeq: 1,
    ...over,
  };
}
