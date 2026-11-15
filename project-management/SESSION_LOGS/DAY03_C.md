# Day 03 — Session C: Architecture, performance and privacy review

**Goal:** Independent review of the design set; resolve findings; architect approval gates.
**Agents/models:**
- Architecture/performance reviewer: subagent, `model: opus` (exact version unknown). 94,844 tokens reported.
- Security/privacy reviewer: subagent, `model: opus` (exact version unknown), adversarial brief. 87,154 tokens reported.
- The two reviews ran in parallel and independently. Neither saw the other's report.
- Resolution and approval: Principal Architect, Claude Opus 5.5.

## Results
| Review | Verdict | Blocker | Major | Minor |
|---|---|---|---|---|
| Architecture/performance | APPROVE WITH CHANGES | 2 | 11 | 8 |
| Security/privacy | APPROVE WITH CHANGES | 2 | 8 | 7 |

Both reviewers independently found the **same two blockers**:
1. Incognito data could reach `lastRelevant`, the snapshot and overrides.
2. Search-results titles could be stored verbatim, because exclusion ran after URL reduction.

## Main resolutions
- **D-015: tab titles and URL paths are never persisted.** They're classified in memory. Recovery reads the live title with `tabs.get`. This removes a whole class of findings: search titles, segment titles, titles in `lastRelevant`, and content-script reads of titles.
- Exclusion runs on the raw URL and title before reduction. Category-based lists with normalisation (IDN, ccTLD, IP, percent-encoding). Internal and extension pages are neutral.
- Incognito: host-less segments only; never touches `lastRelevant`, overrides or snapshot labels.
- Duplicate prevention: `attemptedAt` persisted before effects; notification id = intervention id; no replay of sound or overlay after a restart.
- Policy: an attention gate; a global per-mode cooldown (defaults 15/10/5 min); mute and quiet hours filter channels, not interventions (aligned with BR-7).
- Drift: the accumulator freezes on UNCERTAIN, idle or unfocused instead of resetting.
- An `ENDING` state for crash-safe ends. `lastSeenAt` for gaps when the browser was closed. Stale-pause rule. Segments split on attention changes.
- Startup reconciliation: schema-independent raw purge (also runs in safe mode), retention pruning, alarm re-creation.
- Classification cache dropped. Snapshot published only on change, using `endsAt`. Tick only while ACTIVE, plus one-shot break alarms.
- Messaging: exact `sender.id` + `getURL()` matching; no listeners outside the SW and offscreen; overlay call 2 targets the `documentId` from call 1; nonce in `storage.session`; `isTrusted` on clicks; generic overlay text by default.
- `storage.local.setAccessLevel(TRUSTED_CONTEXTS)` at startup.
- Strict CSP (`default-src 'none'`, `connect-src 'self'`).
- Optional host permission narrowed to http/https.
- Logs keep error codes only.
- **Covert monitoring (new asset A7, threat T20):** start notification + badge + action title; auto-pause after LOCKED > 10 min or IDLE > 30 min (PRD BR-1 amended, AC-32).
- "Private notifications" preference (FR-I12). History keeps only relevant hosts (`relevantHosts` + `otherMinutes`).
- Eight platform facts to verify on Day 05 (ARCH §13).

## Approval gates passed (architect)
- PRD baseline **v1.0**
- ARCHITECTURE v1.0, DATA_MODEL v1.0, API_CONTRACTS v1.0, SECURITY v1.0 (threat model, required before Day 09)
- ADR-0001 to ADR-0006 **Accepted**

## Checks run
- Consistency sweep for stale v0.1 terms across the design docs: clean (only intentional historical mentions).
- Secret scan: see the commit step.
- No code, so there are no tests.

## Next action
Day 04 Session A: UX and accessibility design (onboarding, session creation, panel states, interventions). Include the new "Continue your session?" and start-notification flows.
