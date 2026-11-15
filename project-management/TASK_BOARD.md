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

## Waiting on owner (none block Day 05)
- [ ] Remaining manual checks: M2, M4, M5, M8, M11, M13, M16–M19, and M7 with system volume muted. Needs macOS notifications for Chrome turned on
- [ ] Android device available? (PRD OQ-5). Needed before Day 22
- [ ] Approve downloading Chrome for Testing 120 (Day 05, FEASIBILITY OQ-4)

## Next (Day 05 — repo, environment, scaffold)
- [ ] D05-A1 Stack and standards (Vite + TS strict + React for UI pages, Vitest, ESLint, Prettier); MV3 build layout per ARCHITECTURE §3
- [ ] D05-B1 Scaffold + manifest (permissions per SECURITY table, strict CSP); `npm` scripts; message-bank lint wired into CI (AC-31)
- [ ] D05-B2 CI workflow (type check, lint, unit tests, build). Spikes/prototypes excluded
- [ ] D05-C1 Verify build/test/CI; ARCH §13 V1–V8, UX-3, UX-5, UX-6 in the scaffold; Chrome 120 check if approved

## Day 05 carry-over
- Verify ARCH §13 V1–V8 platform facts in the new scaffold.
- UX-3 install-warning wording, UX-5 `showModal()` from a content script, UX-6 toolbar colours.
- Move `lint-messages.mjs` + `docs/ux/*.json` into the CI pipeline.

## Backlog
See [FEATURE_REGISTRY.md](FEATURE_REGISTRY.md) and [30_DAY_ROADMAP.md](30_DAY_ROADMAP.md).
