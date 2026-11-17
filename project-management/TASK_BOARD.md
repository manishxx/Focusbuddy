# Task board

## Done
- [x] Day 01: PRD, project skeleton, independent review
- [x] Day 02: feasibility spikes, harness, FEASIBILITY.md, independent review; owner/headful manual checks (10 of 19 + sound)
- [x] D03-A1 Component boundaries & data flow
- [x] D03-A2 Persistence choice (ADR-0002, answers OQ-2)
- [x] D03-B1 ARCHITECTURE.md + API_CONTRACTS.md
- [x] D03-B2 DATA_MODEL.md
- [x] D03-B3 SECURITY.md threat model + permission table
- [x] D03-C1 Two independent reviews (38 findings applied); ADR-0001..0006 accepted; PRD v1.0
- [x] D04-A1..A3 Flows, new Day 03 flows, message bank + banned-phrase lint
- [x] D04-B1 Static clickable prototypes
- [x] D04-C1 Independent cognitive-load + WCAG 2.2 AA review (23 + 4 findings applied); UX_GUIDELINES v1.0
- [x] D05 ADR-0007, scaffold, guards, CI, platform facts V1–V8, review + re-check
- [x] D06 Storage layer (validators, repositories, openStorage, deleteAll), review + re-check
- [x] D07 Session state machine, engine, reconciliation, router; AC-02 e2e; review + re-check

## Waiting on owner (none block Day 06)
- [ ] Remaining manual checks: M2, M4, M5, M8, M11, M13, M16–M19, and M7 with system volume muted. Needs macOS notifications for Chrome turned on
- [ ] Android device available? (PRD OQ-5). Needed before Day 22
- [ ] Approve downloading Chrome for Testing 120 (M22; the Day 05 check was skipped without it)
- [ ] M20 (V7 focus) and M21 (toolbar colours) in `tests/manual/OWNER_CHECKS.md`

## Next (Day 08 — goals, contexts, parser)
- [ ] D08-A1 Task model and parser spec: durations (`3 hours`, `90 min`, `1.5h`, `until 5pm`), known-site dictionary (≥ 30), objective and subject extraction, warnings (BR-5)
- [ ] D08-B1 Pure parser + `parse.intent` command; session form logic (draft validation already exists)
- [ ] D08-C1 Parser fixtures (AC-01 and ≥ 40 sentences), independent review

## Carry-over
- Day 10: deterministic idle e2e (15 s threshold) covering the restart test's idle case; real lock check stays manual.
- Day 09: `data.deleteAll` steps 1–3 and 7 with the engine; obsKey format `^[A-Za-z0-9+/=_:-]{1,128}$`.
- Before release: remove `not_implemented`; real safe-mode boot and browser-restart (J10) checks in Chrome.
- Day 09: one injection adapter that awaits `readyHardened` (R7); AC-10 test that injects the overlay and watches the tab's network (Day 05 F4).
- Day 13: move the hard-coded UI strings listed in `src/ui/shared/product.ts` into the bank.
- When a fixed typescript-eslint is ≥ 14 days old: upgrade (npm audit, dev-only).
- Owner: M20 (V7), M21 (UX-6), M22 (Chrome 120 approval) in `tests/manual/OWNER_CHECKS.md`.

## Backlog
See [FEATURE_REGISTRY.md](FEATURE_REGISTRY.md) and [30_DAY_ROADMAP.md](30_DAY_ROADMAP.md).
