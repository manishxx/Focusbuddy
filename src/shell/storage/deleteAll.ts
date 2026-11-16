/**
 * "Delete all data", DATA_MODEL §6 steps 4–6 (steps 1–3 and 7 belong to the
 * engine and UI, later days). Every step is attempted even if an earlier one
 * failed; the result lists the steps that failed.
 */
import { validatePreferences } from "../../core/storage/validate";
import { deleteFbDatabase } from "./idb";
import type { KvArea } from "./kv";
import { withAreaExclusive } from "./kvLock";
import { KEY_PREFS } from "./kvRepos";

export const KEY_UI_SNAPSHOT = "ui.snapshot";

export type DeleteStep = "idb_delete" | "local_clear" | "prefs_restore" | "session_clear" | "snapshot_publish";

export type DeleteAllOptions = {
  local: KvArea;
  session: KvArea;
  idbFactory: IDBFactory;
  /** Closes every IndexedDB connection this context holds (and drops caches). */
  closeFns: readonly (() => void)[];
  keepPrefs: boolean;
  /** The preferences to re-write when keepPrefs is true (validated strictly). */
  prefs?: unknown;
  now?: () => number;
  blockedTimeoutMs?: number;
};

export async function deleteAllStorage(options: DeleteAllOptions): Promise<{ failed: DeleteStep[] }> {
  const { local, session, idbFactory, closeFns, keepPrefs } = options;
  const now = options.now ?? Date.now;
  const failed: DeleteStep[] = [];
  const attempt = async (step: DeleteStep, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch {
      failed.push(step);
    }
  };

  // Step 4: close connections, delete the database (blocked → close again, wait).
  await attempt("idb_delete", () =>
    deleteFbDatabase(idbFactory, closeFns, {
      ...(options.blockedTimeoutMs !== undefined && { blockedTimeoutMs: options.blockedTimeoutMs }),
    }),
  );

  // Steps 5–6 run with each area held exclusively (review N1): pending key-locked
  // writes finish or are refused first, and nothing queued before or during the
  // deletion can write back afterwards (epoch, kvLock.ts).
  // Step 5: clear storage.local, then re-write prefs if the user kept them.
  await withAreaExclusive(local, async () => {
    await attempt("local_clear", () => local.clear());
    if (keepPrefs) {
      await attempt("prefs_restore", async () => {
        const r = validatePreferences(options.prefs);
        if (!r.ok) throw new Error("invalid prefs");
        await local.set(KEY_PREFS, r.value);
      });
    }
  });

  // Step 6: clear storage.session, then republish an empty snapshot.
  await withAreaExclusive(session, async () => {
    await attempt("session_clear", () => session.clear());
    await attempt("snapshot_publish", () =>
      session.set(KEY_UI_SNAPSHOT, { v: 1, at: now(), session: null, notices: [] }),
    );
  });

  return { failed };
}
