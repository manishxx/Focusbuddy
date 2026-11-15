# Day 03 — Session B: Contracts, schemas, diagrams, threat model

**Goal:** Produce the architecture document set for review.
**Agents/models:** Claude Opus 5.5 (main session).

## Files created
- `docs/ARCHITECTURE.md`: principles, runtime contexts (diagram), source layout, engine sequence, session and drift state diagrams, classifier pipeline, policy ladder, timing model, permissions, performance budgets, error handling, test strategy
- `docs/API_CONTRACTS.md`: envelope, sender validation, 20 commands, overlay protocol, offscreen messages, UiSnapshot type, versioning
- `docs/DATA_MODEL.md`: store map, record types, invariants, lifecycle, migrations/safe mode, deletion
- `docs/SECURITY.md`: assets, trust boundaries, permission justification table, threats T1–T16, residual risks, implementation checklist
- `docs/DECISIONS/ADR-0001` to `ADR-0006`

## Tests
None applicable (design documents). Diagrams are Mermaid and render on GitHub (not checked here).

## Next action
Session C: two independent reviews in parallel (architecture/performance and security/privacy).
