/**
 * Service-worker initialisation (D-023, review F11), kept out of sw.ts so it can be
 * unit-tested.
 *
 * - `createBoot` runs init (hardening → openStorage) once and builds the engine, with
 *   the Startup input enqueued before anyone else can see the engine.
 * - If init rejects, it publishes a `storage_error` snapshot, records a diag code if
 *   it can, and rejects. The NEXT call retries (not only after an SW restart).
 *   Callers turn the rejection into `storage_error` replies, never `internal`.
 * - Safe mode (openStorage resolved with mode "safe") is not a failure: the engine
 *   runs and every snapshot carries the `safe_mode` notice.
 * - `writeBootMarker` writes `diag.boot = {seq, at}` to storage.session on every SW
 *   evaluation (no user data), so tests can prove a real restart (review F2).
 */
import type { UiSnapshot } from "../core/session";
import type { Engine } from "./engine/engine";
import type { SnapshotPort } from "./engine/ports";
import type { KvArea } from "./storage/kv";
import { withKeyLock } from "./storage/kvLock";
import type { OpenStorageResult } from "./storage/openStorage";

export const KEY_BOOT = "diag.boot";

export type BootMarker = { seq: number; at: number };

/** Increments `diag.boot.seq` (from 0 when absent or invalid) and stamps `at`. */
export function writeBootMarker(session: KvArea, now: number): Promise<BootMarker> {
  return withKeyLock(session, KEY_BOOT, async (w) => {
    const prev: unknown = await session.get(KEY_BOOT);
    const seq =
      typeof prev === "object" &&
      prev !== null &&
      "seq" in prev &&
      Number.isSafeInteger(prev.seq) &&
      Number(prev.seq) >= 0
        ? Number(prev.seq)
        : 0;
    const marker = { seq: seq + 1, at: now };
    await w.set(marker);
    return marker;
  });
}

export type BootDeps = {
  /** Hardening + openStorage. May reject. */
  init: () => Promise<OpenStorageResult>;
  /** Builds the engine over the opened repositories (does not enqueue anything). */
  makeEngine: (opened: OpenStorageResult) => Engine;
  /** Where the failure snapshot goes (storage.session `ui.snapshot`). */
  snapshot: SnapshotPort;
  /** Best-effort diag write for a boot failure (storage.local may still work). */
  recordDiag: (code: string) => Promise<void>;
  now: () => number;
};

export class BootError extends Error {
  constructor() {
    super("E_BOOT_FAILED");
    this.name = "BootError";
  }
}

export function createBoot(deps: BootDeps): { engine(): Promise<Engine> } {
  let current: Promise<Engine> | null = null;

  async function attempt(): Promise<Engine> {
    let opened: OpenStorageResult;
    try {
      opened = await deps.init();
    } catch {
      const at = deps.now();
      const snap: UiSnapshot = { v: 1, at, session: null, notices: [{ code: "storage_error", at }] };
      await deps.snapshot.publish(snap).catch(() => undefined);
      await deps.recordDiag("E_BOOT_FAILED").catch(() => undefined);
      throw new BootError();
    }
    const engine = deps.makeEngine(opened);
    // Synchronously, before anyone else can see the engine: Startup is the first input.
    void engine.enqueue({ kind: "startup" });
    return engine;
  }

  return {
    engine() {
      if (current === null) {
        const p = attempt();
        current = p;
        // A failed init is forgotten, so the next input retries it.
        p.catch(() => {
          if (current === p) current = null;
        });
      }
      return current;
    },
  };
}
