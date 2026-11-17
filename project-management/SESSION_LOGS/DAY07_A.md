# Day 07 — Session A: Session state machine and engine design

**Agents/models:** Principal Architect, Claude Opus 5.5 (main session).

## Output (D-021)
- ARCHITECTURE v1.1 §5.1.1: the full transition table (inputs, guards, effects, alarms, badge, notifications), exact time formulas, the reconciliation scope for Day 07, and the effect-idempotence rules.
- DATA_MODEL v1.3: `ActiveState.attentionSince` and `notified` (per-notification attempt time, so nothing replays after a restart).

## Decisions
- **Unanswered break:** the clock stays stopped. "Break's over?" never eats session time; BR-3 limits the prompt to one repeat.
- **Auto-pause:** the pause starts at `attentionSince`, so the absence is excluded from session time and reported as away. The continue prompt is shown once, when the user returns.
- **Corrupt active state:** ended as `stale_pause`, no summary.
- **Not in Day 07:** tab observation (Day 09), summary aggregates from activity (zero until Day 09+), the UI (Day 13).

## Next action
Session B: implementation (delegated to an implementer subagent).
