# Day 01 — Session A: Product analysis and user journeys

**Goal:** Turn the product vision into concrete user journeys and surface the
requirement-level risks the PRD must resolve.
**Agents/models:** Orchestrator / Principal Architect — Claude Opus 5.5 (main session). No subagents.
**Estimated token budget:** ~25k (estimate). Actual: unknown (not exposed by tooling).

## Tasks attempted
1. Decomposed the master prompt's primary scenario (A–F) into journeys J1–J10.
2. Checked each scenario against what a Manifest V3 extension can actually do.
3. Listed requirement gaps that would otherwise surface as defects later.

## Findings (fed into docs/PRD.md)

| # | Finding | Consequence for the PRD |
|---|---------|-------------------------|
| 1 | "Pattern Recognition" as a keyword does **not** match "K Nearest Neighbors Explained". Plain keyword matching fails Scenario B. | Session needs a *topic vocabulary* (user keywords + optional one-time AI expansion + bundled topic packs), and an `UNCERTAIN` class that never triggers an intervention on its own. |
| 2 | A false "you're distracted" alert while studying costs more trust than a missed distraction. | Bias toward not interrupting: intervene only on `LIKELY_IRRELEVANT` sustained past a threshold. |
| 3 | Scenario E's "your next step was to understand how K affects the decision boundary" cannot be known by rules. | Recovery text comes from a user-entered "next step" note, else the last relevant tab title, else the objective. Optional AI may phrase it. |
| 4 | Natural-language task input must not depend on paid AI. | Deterministic parser (duration, known site names → domains, objective text) plus a confirm/edit form. AI parsing optional. |
| 5 | `chrome.idle` reports no-input, not "not studying". Reading a long PDF looks idle. | Idle pauses timing / evidence collection; it is never itself treated as a distraction. |
| 6 | Full-screen interruption = in-page overlay from a content script; impossible on `chrome://`, Web Store, some PDF/viewer pages, and needs host permission. | Overlay is best-effort with notification fallback. Permission strategy is an approval-gate decision (Day 3). |
| 7 | Reading tab titles/URLs needs the `tabs` permission (shown to users as "Read your browsing history"). | Must be justified on-screen; data stays local; incognito off by default. |
| 8 | MV3 service worker can be killed at any time; timers in memory are lost. | All session state persisted; use `chrome.alarms` (≥30 s granularity) not `setTimeout` for thresholds. |
| 9 | Audio in MV3 requires an offscreen document; autoplay may be blocked; OS may be muted. | Audio is "best effort" with a visual fallback; never the only channel. |
| 10 | Phone-side detection is impossible from the extension. | Android companion is a separate app; V1 Definition of Done must not depend on it. Quick desk feasibility on Day 2, formal gate Day 22. |

## Journeys defined
J1 first run & onboarding · J2 create session from natural language · J3 productive work (silent) ·
J4 drift → escalating interventions · J5 recovery · J6 intentional break · J7 end session & summary ·
J8 false-positive feedback · J9 privacy controls & data deletion · J10 browser/service-worker restart.

## Remaining work → Session B
Write PRD with requirement IDs, priorities, testable acceptance criteria; create project-management skeleton.

## Next action
Day 01 Session B.
