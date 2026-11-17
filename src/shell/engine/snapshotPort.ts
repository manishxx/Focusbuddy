/**
 * UiSnapshot store (API_CONTRACTS §6): `ui.snapshot` in storage.session. Writes go
 * through the key lock, so a publish queued before "Delete all data" is refused
 * (E_STORAGE_DELETED) instead of resurrecting deleted state (DATA_MODEL §8.1).
 */
import type { UiSnapshot } from "../../core/session";
import { KEY_UI_SNAPSHOT } from "../storage/deleteAll";
import type { KvArea } from "../storage/kv";
import { withKeyLock } from "../storage/kvLock";
import type { SnapshotPort } from "./ports";

export function kvSnapshotPort(session: KvArea): SnapshotPort {
  return {
    read: () => session.get(KEY_UI_SNAPSHOT),
    publish: (snapshot: UiSnapshot) => withKeyLock(session, KEY_UI_SNAPSHOT, (w) => w.set(snapshot)),
  };
}
