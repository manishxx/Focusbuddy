/**
 * The engine (ARCHITECTURE §4): one input at a time through a promise queue.
 *
 *   load session.active → reduce → persist (put / remove) → run effects
 *
 * - Persist happens BEFORE effects. If it fails, no effect runs and a diag code is
 *   recorded (plus a storage_error notice for the next snapshot, ARCHITECTURE §10).
 * - E_STORAGE_DELETED means "Delete all data" won the race: the input is dropped
 *   quietly (DATA_MODEL §8.1).
 * - Effects run in order; each failure becomes a diag code and the rest still run.
 * - A corrupt session.active is ended (stale_pause, no summary) before any input
 *   is applied to it (DATA_MODEL §8).
 * - An ENDING session.active is finished (summary + purge + remove) before any input
 *   is applied (D-023, review F3), so a failed summary write never leaves the user stuck.
 * - Startup gets the notification state from the port (AC-32 start repeat, leftover
 *   fb.* notifications); `idle` events are back-dated by idleThresholdSec (D-023, F7).
 */
import { defaultPreferences } from "../../core/storage/defaults";
import {
  buildSnapshot,
  notificationIds,
  reduceSession,
  snapshotKey,
  type Effect,
  type ErrorCode,
  type Notice,
  type ReduceResult,
  type SessionInput,
} from "../../core/session";
import type { Clock } from "../../core/clock";
import type { ActiveState, Preferences } from "../../core/types";
import { errorCode } from "../storage/idb";
import type { DiagRepo, PrefsRepo } from "../storage/kvRepos";
import { STORAGE_DELETED } from "../storage/kvLock";
import type { StorageRepos } from "../storage/openStorage";
import { text } from "./format";
import type { EffectPorts } from "./ports";
import { buildSummaryAndPurgeRaw } from "./summary";

const SNAPSHOT_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Badge text colour (UX_GUIDELINES §2.1: white on every fill). */
export const BADGE_TEXT_COLOR = "#ffffff";

export type EngineRepos = Pick<StorageRepos, "active" | "prefs" | "diag" | "sessions" | "segments" | "interventions">;

export type EngineReply =
  | { ok: true; data?: Readonly<Record<string, unknown>> }
  | { ok: false; error: ErrorCode; data?: Readonly<Record<string, unknown>> };

export type EngineOptions = {
  repos: EngineRepos;
  ports: EffectPorts;
  clock: Clock;
  newId: () => string;
  /** Start-up notices (openStorage), shown in every snapshot of this wake. */
  notices?: readonly Notice[];
  /**
   * Storage opened in safe mode (DATA_MODEL §5): session.* / break.* reply storage_error
   * with no state change, and Startup ends any session (stale_pause, no summary).
   * prefs.get and diag.get (run()) keep working.
   */
  safeMode?: boolean;
  /** The reducer; tests inject one to drive effects the Day 07 reducer never emits. */
  reduce?: typeof reduceSession;
};

export interface Engine {
  /** Queues one input; resolves with the reply once it has been processed. */
  enqueue(input: SessionInput): Promise<EngineReply>;
  /** Queues a read-only job (prefs.get, diag.get) behind earlier inputs. */
  run<T>(job: (repos: EngineRepos) => Promise<T>): Promise<T>;
}

const isDeleted = (error: unknown): boolean => errorCode(error, "") === STORAGE_DELETED;

async function readPrefs(prefs: PrefsRepo): Promise<Preferences> {
  try {
    return (await prefs.get()).prefs;
  } catch {
    return defaultPreferences();
  }
}

async function appendDiag(diag: DiagRepo, codes: readonly string[]): Promise<void> {
  try {
    await diag.appendMany(codes);
  } catch {
    // Diag is best effort.
  }
}

export function createEngine(options: EngineOptions): Engine {
  const { repos, ports, clock, newId } = options;
  const reduce = options.reduce ?? reduceSession;
  const notices: Notice[] = (options.notices ?? []).map((n) => ({ code: n.code, at: n.at }));
  let lastSummaryId: string | undefined;
  let lastPublished: string | null = null;
  let seeded = false;
  let tail: Promise<unknown> = Promise.resolve();

  function serial<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(job, job);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function addNotice(code: Notice["code"], at: number): void {
    if (!notices.some((n) => n.code === code)) notices.push({ code, at });
  }

  /** lastSummaryId survives SW restarts in storage.session (not browser restarts). */
  async function seedFromSnapshot(): Promise<void> {
    if (seeded) return;
    seeded = true;
    try {
      const raw = await ports.snapshot.read();
      if (typeof raw === "object" && raw !== null && "lastSummaryId" in raw) {
        const id: unknown = raw.lastSummaryId;
        if (typeof id === "string" && SNAPSHOT_ID.test(id)) lastSummaryId = id;
      }
    } catch {
      // Nothing to seed.
    }
  }

  async function runEffect(fx: Effect, state: ActiveState | null, codes: string[]): Promise<void> {
    switch (fx.type) {
      case "ScheduleAlarm":
        await ports.alarms.create(
          fx.name,
          fx.when !== undefined ? { when: fx.when } : { periodMin: fx.periodMin ?? 0.5 },
        );
        return;
      case "ClearAlarm":
        await ports.alarms.clear(fx.name);
        return;
      case "ShowNotification":
        await ports.notifications.create(fx.id, { title: text(fx.titleKey, {}), message: text(fx.bodyKey, fx.vars) });
        return;
      case "ClearNotification":
        await ports.notifications.clear(fx.id);
        return;
      case "SetBadge":
        await ports.action.setBadgeText(fx.text);
        if (fx.color !== undefined) await ports.action.setBadgeColors(fx.color, BADGE_TEXT_COLOR);
        return;
      case "SetActionTitle":
        await ports.action.setTitle(text(fx.key, fx.vars));
        return;
      case "PublishSnapshot": {
        const snap = buildSnapshot(state, notices, lastSummaryId, clock.now());
        const key = snapshotKey(snap);
        if (key === lastPublished) return; // published only when its content changes (§6)
        await ports.snapshot.publish(snap);
        lastPublished = key;
        return;
      }
      case "BuildSummaryAndPurgeRaw": {
        const out = await buildSummaryAndPurgeRaw(state, fx, repos);
        codes.push(...out.codes);
        if (out.summaryId !== undefined) lastSummaryId = out.summaryId;
        return;
      }
      case "AppendSegment": {
        if (repos.segments === null) return;
        const r = await repos.segments.append(fx.segment);
        // After a crash, the segment may already be there (DATA_MODEL §8).
        if (!r.ok && !r.errors.includes("segment:duplicate_seq")) codes.push("E_SEGMENT_INVALID");
        return;
      }
      case "Diag":
        codes.push(fx.code);
        return;
    }
  }

  const FX_CODES: Readonly<Record<Effect["type"], string>> = {
    ScheduleAlarm: "E_FX_ALARM_CREATE",
    ClearAlarm: "E_FX_ALARM_CLEAR",
    ShowNotification: "E_FX_NOTIFICATION_CREATE",
    ClearNotification: "E_FX_NOTIFICATION_CLEAR",
    SetBadge: "E_FX_BADGE",
    SetActionTitle: "E_FX_ACTION_TITLE",
    PublishSnapshot: "E_FX_SNAPSHOT",
    BuildSummaryAndPurgeRaw: "E_FX_SUMMARY",
    AppendSegment: "E_FX_SEGMENT",
    Diag: "E_FX_DIAG",
  };

  async function runEffects(effects: readonly Effect[], state: ActiveState | null): Promise<void> {
    const codes: string[] = [];
    for (const fx of effects) {
      try {
        await runEffect(fx, state, codes);
      } catch (error) {
        if (!isDeleted(error)) codes.push(FX_CODES[fx.type]);
      }
    }
    if (codes.length > 0) await appendDiag(repos.diag, codes);
  }

  /** Persists `result.state`; returns an error reply if the write failed. */
  async function persist(
    before: ActiveState | null,
    hadRecord: boolean,
    result: ReduceResult,
    now: number,
  ): Promise<EngineReply | null> {
    const next = result.state;
    if (next === null ? !hadRecord : before !== null && JSON.stringify(before) === JSON.stringify(next)) return null;
    try {
      if (next === null) await repos.active.remove();
      else {
        const written = await repos.active.put(next);
        if (!written.ok) {
          await appendDiag(repos.diag, ["E_ACTIVE_INVALID_WRITE"]);
          return { ok: false, error: "internal" };
        }
      }
      return null;
    } catch (error) {
      if (isDeleted(error)) return { ok: false, error: "storage_error" };
      addNotice("storage_error", now);
      await appendDiag(repos.diag, [errorCode(error, "E_PERSIST_FAILED")]);
      return { ok: false, error: "storage_error" };
    }
  }

  /** Startup reads what the reducer can't: which notifications are showing. */
  async function withNotificationState(state: ActiveState | null, input: SessionInput): Promise<SessionInput> {
    if (input.kind !== "startup" || input.corrupt === true) return input;
    if (state === null) {
      const ids = await ports.notifications.listIds().catch((): string[] => []);
      return { ...input, shownNotificationIds: ids };
    }
    if (state.session.state !== "ACTIVE") return input;
    // Unknown counts as shown: never risk a duplicate.
    const shown = await ports.notifications.exists(notificationIds(state.session.id).start).catch(() => true);
    return { ...input, startShown: shown };
  }

  async function step(state: ActiveState | null, hadRecord: boolean, raw: SessionInput): Promise<EngineReply> {
    const now = clock.now();
    const prefs = await readPrefs(repos.prefs);
    // Chrome reports "idle" only after idleThresholdSec without input: back-date it to
    // the last real input (the reducer clamps it to attentionSince / startedAt).
    const backdated: SessionInput =
      raw.kind === "idle" && raw.state === "idle" ? { ...raw, at: raw.at - prefs.idleThresholdSec * 1_000 } : raw;
    const input = await withNotificationState(state, backdated);
    let result: ReduceResult;
    try {
      result = reduce(state, input, {
        now,
        privateNotifications: prefs.privateNotifications,
        defaultMode: prefs.defaultMode,
        newId,
      });
    } catch {
      await appendDiag(repos.diag, ["E_REDUCER_THREW"]);
      return { ok: false, error: "internal" };
    }
    if (result.error !== undefined) {
      return { ok: false, error: result.error, ...(result.data !== undefined && { data: result.data }) };
    }
    const failed = await persist(state, hadRecord, result, now);
    if (failed !== null) return failed;
    await runEffects(result.effects, result.state);
    return { ok: true, ...(result.data !== undefined && { data: result.data }) };
  }

  async function process(original: SessionInput): Promise<EngineReply> {
    if (options.safeMode === true && original.kind === "command") return { ok: false, error: "storage_error" };
    const input: SessionInput =
      options.safeMode === true && original.kind === "startup" ? { ...original, safeMode: true } : original;
    if (input.kind === "startup") await seedFromSnapshot();
    let read;
    try {
      read = await repos.active.get();
    } catch (error) {
      if (!isDeleted(error)) await appendDiag(repos.diag, [errorCode(error, "E_ACTIVE_READ")]);
      return { ok: false, error: "storage_error" };
    }
    if ("corrupt" in read) {
      // End the unreadable session first (stale_pause, no summary), then apply the input.
      const ended = await step(null, true, { kind: "startup", corrupt: true });
      if (input.kind === "startup" || !ended.ok) return ended;
      return step(null, false, input);
    }
    if ("state" in read && read.state.session.state === "ENDING" && input.kind !== "startup") {
      // Finish the ending first, then apply the input to what is left.
      await step(read.state, true, { kind: "startup" });
      let again;
      try {
        again = await repos.active.get();
      } catch (error) {
        if (!isDeleted(error)) await appendDiag(repos.diag, [errorCode(error, "E_ACTIVE_READ")]);
        return { ok: false, error: "storage_error" };
      }
      if ("state" in again) return step(again.state, true, input); // still ENDING: stop → ok, others invalid
      return process(input); // gone (or corrupt): handled as usual, no ENDING loop
    }
    return "state" in read ? step(read.state, true, input) : step(null, false, input);
  }

  return {
    enqueue: (input) =>
      serial(async () => {
        try {
          return await process(input);
        } catch {
          await appendDiag(repos.diag, ["E_ENGINE_FAILED"]);
          return { ok: false, error: "internal" } satisfies EngineReply;
        }
      }),
    run: (job) => serial(() => job(repos)),
  };
}
