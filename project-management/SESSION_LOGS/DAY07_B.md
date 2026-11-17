# Day 07 — Session B: Session state machine and engine implementation

**Agents/models:**
- Implementer: subagent, `model: opus` (exact version unknown). Two runs: 322,715 and 359,404 tokens reported (cumulative or not: unknown).
- Ambiguity decisions (D-022): Principal Architect, Claude Opus 5.5 (main session).

## Files
- **`src/core/session/`:**
  - `reducer.ts`: the §5.1.1 table.
  - `time.ts`, `present.ts` (badge, tooltip, alarm sets, notification ids), `snapshot.ts`.
  - `summary.ts`, `draft.ts`, `types.ts`.
- **`src/shell/engine/`:**
  - `engine.ts`: serialised queue; load → reduce → persist → effects.
  - `summary.ts`: idempotent BuildSummaryAndPurgeRaw.
  - `format.ts`, `ports.ts`, `snapshotPort.ts`.
- **`src/shell/adapters/`:** `chrome.ts` (thin wrappers), `chromeVersion.ts`.
- **`src/shell/messaging/router.ts`:** exact sender check, envelope, session/break/prefs/diag commands.
- **`src/shell/sw.ts`:** hardening → openStorage → engine → Startup; alarm, idle and message listeners at top level.
- **Validators/types:** `attentionSince`, `awayMs`, `notified` (DATA_MODEL v1.3).
- **Tests:** `tests/unit/session/*` (table rows, property tests over 60 seeds × 250 steps, reconciliation), `tests/unit/engine/*`, `tests/e2e/session-restart.mjs` (`npm run e2e:session`).

## Architect decisions on the implementer's questions (D-022)
- Browser-closed time counts as session time and is tracked in `awayMs`; a gap ≥ 10 min auto-pauses on return.
- A break open for more than 4 h ends the session (`stale_pause`).
- `session.extend` over the cap clamps and replies `cappedAt`.
- Summary building keeps interventions.
- `notified` is per occurrence.
- A tick refreshes `lastSeenAt` at most every 60 s.
- Alarms get `persistAcrossSessions` on Chrome ≥ 150.
- API_CONTRACTS v1.2: `invalid_argument`, `not_implemented`, `SessionDraft`.

## Tests (architect's own runs after the hand-back; Chrome 157.0.8103.79 headless)
| Check | Result |
|---|---|
| `npm run ci` | exit 0: **862 tests passed**; lines 99.55 %; build and guards PASS |
| `npm run e2e:smoke` | `"ok": true` |
| `npm run e2e:session` (AC-02) | exit 0, **32/32 checks**. Two SW restarts (ACTIVE, then PAUSED): `endsAt` delta 0 ms, exactly one notification, alarms and badge correct, `session.active` valid, SessionRecord written on stop, everything cleared. First real-Chrome run of the Day 06 storage layer |

**Harness finding:** in Chrome 157 a Puppeteer worker handle that stays attached keeps a stopped SW target alive, so the SW doesn't restart. The e2e reads SW state through a short raw CDP session that is detached at once.

**Not covered by unit tests:** `src/shell/sw.ts` and `src/shell/adapters/chrome.ts` (exercised by the e2e runs only). Chrome 120: untested.
