# Day 01 — Session C: Independent review, fixes, sync

**Goal:** Review the PRD independently, fix what's found, record assumptions, commit and push.
**Agents/models:**
- Independent reviewer: subagent, `model: opus` (exact version unknown). It read the PRD, roadmap and registry only, and had no access to the author's reasoning.
- Fixes and logs: Orchestrator, Claude Opus 5.5.

## Review result
**APPROVE WITH CHANGES**: 10 MAJOR and 7 MINOR findings, 0 BLOCKER. All 17 have been applied:

| # | Finding (short) | Resolution |
|---|---|---|
| 1 | Native notifications allow only 2 buttons | FR-I5 rewritten; D-012 |
| 2 | No notification volume; OS can suppress them | FR-I3 reworded; new FR-I10, AC-27 |
| 3 | Gentle could be invisible with the panel closed | FR-I2: the badge is always shown |
| 4 | Audio P1 vs Strict P0 | FR-I9 basic sound + volume → P0 |
| 5 | Alarms 30 s granularity / min Chrome | NFR-11 → Chrome 120; FR-C6 tolerance; D-011 |
| 6 | Overlay needs `<all_urls>` | FR-I6 → opt-in P1; D-009; AC-24 |
| 7 | Titles kept 30 days | FR-H2 two-tier retention; FR-H6; FR-M5/M6; AC-09, AC-28; D-010 |
| 8 | P0 FRs without ACs | AC-17 – AC-31 added |
| 9 | Underspecified behaviour | §5.11 BR-1 – BR-8 |
| 10 | Escape is page-only | FR-I11 global `chrome.commands` shortcut; AC-26 |
| 11 | No long-session NFR | NFR-12 |
| 12 | Hourly cap only | Per-session cap in FR-I7; AC-06 |
| 13 | AC wording gaps | AC-04, AC-10, AC-12 tightened; FR-M2 favicon rule |
| 14 | Registry ↔ PRD drift | Registry re-mapped; F-023, F-024, F-025 added |
| 15 | Platform edge cases | FR-M1 `onReplaced`; FR-M9; FR-P2 per-window; §8.3, §8.7 |
| 16 | ADHD UX | FR-H3 reframed; countdown default 5 s, opt-in; BR-3 |
| 17 | Mid-programme P0 overload | Overlay moved to P1 (finding 6) |

The reviewer was unsure of two platform facts. They're now PRD OQ-7 and OQ-8, scheduled as Day 2 spikes.

## Checks run
- Secret scan (grep for key/token/password assignments) over all new files: **no matches**.
- No code exists yet, so lint, type check and tests are not applicable.

## Assumptions documented
PRD §11 (6 assumptions). New: the owner has not yet confirmed an Android device (OQ-5).

## Token/cost
Reviewer subagent: 72,290 total tokens, as reported by the harness (input/output split unknown). Orchestrator: unknown.

## Next action
Day 02 Session A: Chrome API feasibility research (TASK_BOARD "Next").
