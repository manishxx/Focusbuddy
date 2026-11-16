# Day 06 — Session A: Storage design

**Agents/models:** Principal Architect, Claude Opus 5.5 (main session).

## Decisions (D-020; DATA_MODEL v1.2 §7–§8)
- **Validation:** hand-written, pure, strict validators. No new runtime dependency.
  - Unknown keys fail the record, so a `title`, `url` or `path` can't be stored: invariant 1 is enforced by structure.
  - Preferences fall back per field (AC-15).
- **Repositories:** in the shell, over `KvArea` + IndexedDB `fb` v1 (three stores and their indexes defined). Validate on write and on read.
- **Startup order:**
  1. migrate;
  2. open IndexedDB;
  3. raw purge (schema-independent, runs in safe mode too);
  4. retention.
- **Test dependency:** `fake-indexeddb` 6.2.7 (17 days old, Apache-2.0, zero deps). Dev only.
- **Out of scope today:** the engine, reconciliation, the full `deleteAll` (alarms, notifications, offscreen) and summary building. Today provides the storage primitives those steps call.

## Next action
Session B: implementation (delegated to an implementer subagent).
