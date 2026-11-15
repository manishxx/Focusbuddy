# Master plan

## Objective
A reliable, privacy-conscious Focus Buddy V1 Chrome extension within 30 development
days. It must be useful with no paid AI. Android is reported separately as complete,
prototype-only, blocked or deferred.

## Daily rhythm
Each `continue` runs one development day:
- **Session A — plan/design:** refine the day's tasks and acceptance criteria; architect decisions recorded.
- **Session B — implement:** bounded tasks, implemented by the orchestrator or subagents.
- **Session C — verify/sync:** tests, lint, type check, an **independent subagent review**, fixes, logs, commit, push, remote check.

Work stops at the end of the day, or earlier if blocked, at an approval gate, or at a budget limit.

## Branching
- One branch per day: `docs/day-NN-<topic>` or `feat/day-NN-<topic>`.
- It's merged into `main` (fast-forward or merge commit, never force) only once Session C passes.
- Unfinished work stays on its branch, and its status is recorded.

## Approval gates (architect)
| Gate | Day | Artefact |
|---|---|---|
| Requirements baseline | 3 | PRD v1.0 |
| Architecture + data model | 3 | ARCHITECTURE.md, DATA_MODEL.md, ADRs |
| Permissions & privacy | 3 | SECURITY.md threat model |
| AI boundary | 19 | ADR |
| Android go/no-go | 22 | FEASIBILITY.md section + ADR |
| Release | 30 | Release assessment |

## Owner-dependent items
- Real-browser manual checks (notifications, audio, side panel, overlay): the owner runs the checklists.
- Android device availability (PRD OQ-5).
- Any paid service (blocked by D-003 until the owner approves).

## Definition of Done
See PRD §9 and the master prompt §17. Mirrored in the V1 row of `FEATURE_REGISTRY.md`.
