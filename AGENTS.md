# AGENTS.md — rules for every agent working on Focus Buddy

## Source of truth
The repository files are the source of truth, not chat history. Before working, read
`project-management/CURRENT_STATE.md`, then only the files your task needs.

## Model tiers (as actually available in this environment)
The Claude Code Agent tool can pick only the model *families* `opus`, `sonnet`,
`haiku` and `fable`. It cannot pin exact versions. Mapping used:

| Tier | Role | How it runs here |
|---|---|---|
| 1 | Principal Architect / orchestrator | Main session. Claude Opus 5.5 through Day 07 Session B; **Claude Fable 5.2 from Day 07 Session C**, after the owner changed the session model with `/model` on 2026-11-16 |
| 2 | Implementer / independent reviewer | Subagent, `model: opus` (exact version unknown; may equal Tier 1 cost) |
| 3 | Routine files, docs, formatting | Subagent, `model: sonnet`, or the orchestrator when delegating would cost more context than it saves |

Logs record the model *requested* and say "exact version unknown" where that's the case.
Never claim that a specific version ran unless the tooling reports it.

## Rules
1. Bounded tasks: every delegated task gets its files, interfaces and acceptance criteria.
2. The reviewer is never the implementer. Reviewers read the code and evidence, and don't take the implementer's word for it.
3. No invented test results, reviews, costs or pushes. Unknown means "unknown".
4. Two agents never edit the same file at the same time.
5. Approval gates (architecture, data model, permissions/privacy, AI boundary, major refactors, security, release) need the architect's sign-off, recorded in `docs/DECISIONS/`.
6. Statuses: `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `IMPLEMENTED`, `TESTED`, `REVIEWED`, `DONE`. `DONE` needs passing tests and the required review.
7. Conventional Commits. Never force-push or rewrite history. Never push broken code to `main`.
8. No new paid services or API usage without the owner's explicit approval (standing decision D-003).
9. Privacy: no keylogging, no page content, no covert monitoring, no secrets in the bundle.
