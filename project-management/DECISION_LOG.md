# Decision log

Short entries. Architecturally significant decisions also get an ADR in `docs/DECISIONS/`.

| ID | Date | Day | Decision | Rationale | Decided by |
|---|---|---|---|---|---|
| D-001 | 2026-11-15 | 0 | Project at `~/code/focus-buddy`, remote `git@github.com:manishxx/Focusbuddy.git`, author "Manish Pandey" (repo-local). | Owner choice at setup. | Owner |
| D-002 | 2026-11-15 | 0 | Model tiers map to Agent-tool families (`opus`/`sonnet`); exact versions are not pinnable. | Tooling limitation; see AGENTS.md. | Architect |
| D-003 | 2026-11-15 | 0 | No new paid services. Runtime AI is built against a mock provider; real provider needs a new approval. | Owner budget decision. | Owner |
| D-004 | 2026-11-15 | 1 | The `UNCERTAIN` class never triggers an intervention on its own. | False positives cost more trust than misses (PRD §2, §5.4). | Architect |
| D-005 | 2026-11-15 | 1 | Being on the allowlist doesn't make a mixed-use domain (YouTube etc.) relevant; the title decides. | Scenario B/C share a domain. | Architect |
| D-006 | 2026-11-15 | 1 | Idle is neutral (pauses evidence), never distraction. | `chrome.idle` measures input, not attention. | Architect |
| D-007 | 2026-11-15 | 1 | Android is a gated separate track; V1 DoD does not depend on it. | Protect the desktop critical path. | Architect |
| D-009 | 2026-11-15 | 1 | In-page overlay is opt-in and P1; it needs optional host permission requested with a gesture; notification is the fallback. | Review finding 6: `<all_urls>` warning and risk. | Architect (from review) |
| D-010 | 2026-11-15 | 1 | Two-tier retention: raw titles only for the life of a session; aggregates 30 days. | Review finding 7: titles leak sensitive info. | Architect (from review) |
| D-011 | 2026-11-15 | 1 | Minimum Chrome 120; thresholds evaluated from persisted timestamps; +30 s onset tolerance. | Review finding 5: alarms granularity. | Architect (from review) |
| D-012 | 2026-11-15 | 1 | Native notifications carry 2 actions; the full action set is in the panel/overlay; global `chrome.commands` mute shortcut. | Review findings 1, 10. | Architect (from review) |
| D-008 | 2026-11-15 | 1 | Day work happens on `docs/day-NN-*` / `feat/day-NN-*` branches; merged to `main` only after Session C passes. | Owner chose a branch at Day 1; avoids broken `main`. | Owner + Architect |
| D-013 | 2026-11-15 | 2 | Adopt FEASIBILITY scope decisions SD-1 to SD-10 (Chrome 120 provisional; alarms re-created on SW start; overlay via optional `<all_urls>`; notification click opens a tab; offscreen on demand; placeholder titles UNCERTAIN; ≤ 2 notification buttons; puppeteer-core harness; Android Option A only; `contextMenus` for FR-I11). | Day 2 evidence + independent review. | Architect |
| D-014 | 2026-11-15 | 2 | Android estimate 6–10 days exceeds the 4-day window. Expected outcome is at most prototype-only, and a device is a hard gate. Phone→desktop status deferred (FR-D3). | Review finding 12. | Architect |
