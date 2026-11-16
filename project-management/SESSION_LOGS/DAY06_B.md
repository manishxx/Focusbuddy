# Day 06 — Session B: Storage implementation

**Agents/models:**
- Implementer: subagent, `model: opus` (exact version unknown). Two runs: 215,590 and 231,147 tokens reported (cumulative or not: unknown).
- Ambiguity decisions (DATA_MODEL §8.1): Principal Architect, Claude Opus 5.5.

## Files
- **`src/core/types.ts`:** all record types.
- **`src/core/storage/`:**
  - `defaults.ts`
  - `validate.ts` (strict validators + `parsePreferences`)
  - `migrations.ts` (pure runner), `diag.ts`, `retention.ts`
- **`src/shell/storage/`:**
  - `kv.ts` (KvArea + chrome adapters), `memoryKv.ts`, `idb.ts` (fb v1, blocked/versionchange handling, delete with retry)
  - `kvRepos.ts` (prefs, overrides, active, meta, diag), `idbRepos.ts` (segments with the 5,000 cap, interventions, sessions with prune cascade)
  - `openStorage.ts`, `deleteAll.ts`
- **`tests/unit/storage/`:** 7 files, 270 tests, using a fresh `fake-indexeddb` `IDBFactory` per test.
- **`vitest.config.ts`:** per-file 80 % lines now also covers `src/shell/storage/**`.

## Implementer choices accepted by the architect
- `validateX` naming.
- Injected `IDBKeyRange`.
- `close()` returned from openStorage.
- Version-less open aborts creation (so a later versioned open builds the stores).
- Orphan-intervention pruning.
- Safe mode skips retention.
- A failed backend write rejects with a code-only `StorageError`.

## Ambiguities → DATA_MODEL §8.1 (architect)
- Defaults and upper bounds.
- String minimums (`taskLabel` ≥ 1).
- Id and `obsKey` formats.
- Prefs repair is written back at startup.
- `quietHours` start ≠ end; `lastSeenAt` ≥ `startedAt`.

## Tests (architect's own run after the hand-back)
| Check | Result |
|---|---|
| `npm run ci` | exit 0: **537 tests passed**; lines 99.64 % overall; every storage file ≥ 98.86 % lines; build 17 files; manifest + secret scans PASS |
| `npm run e2e:smoke` | `"ok": true` |

**Not run:** real Chrome `chrome.storage` / IndexedDB. The storage layer isn't wired into the SW until Day 07, so it isn't in the bundle yet.
