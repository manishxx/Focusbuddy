# 30-day roadmap (architect-refined baseline)

Token budgets are **planning estimates** for the whole day, not measurements.
"Deps" lists days whose outputs must be verified first.

## Architect refinements to the baseline (Day 01 review)
1. **Day 2** also does a *desk-only* Android feasibility note (≤ 1 h), so the Day 22 gate has data and isn't a surprise.
2. **Day 3** produces the security & privacy threat model (moved earlier from Day 27). Monitoring (Day 9) must not start without it. Day 27 becomes the *re-review*.
3. **Day 4** UI prototypes are static HTML/CSS clickable mocks. The real toolchain doesn't exist until Day 5. Prototypes are throwaway.
4. **Day 5** CI runs type check, lint, unit tests and build from the first scaffold commit. Day 2 spikes stay in `spikes/` and are excluded from CI.
5. **Day 13** (side panel) depends on Day 7 (state machine), not only Day 12. It may start against a mocked state API.
6. **Day 17** audio research is front-loaded into the Day 2 offscreen-document experiment.
7. **Days 23–26** default to *desktop hardening* unless the Day 22 gate passes **and** an Android device is confirmed (PRD OQ-5).

## Schedule

| Day | Theme | A — plan/design | B — implement | C — test/review/sync | Deps | Est. tokens |
|---|---|---|---|---|---|---|
| 01 | Product requirements | Journeys, constraints | PRD, PM skeleton | Independent PRD review, commit | — | 120k |
| 02 | Feasibility | Chrome API research | Spikes: tabs, idle, side panel, offscreen audio, overlay permission; Android desk note | Limitations doc, scope decisions | 01 | 200k |
| 03 | Architecture | Components, data flow, persistence | Contracts, schemas, diagrams, **threat model** | Architecture/perf/privacy review; ADRs approved | 02 | 220k |
| 04 | UX & a11y | Onboarding, session, panel, interventions | Static clickable prototypes | Cognitive-load + a11y review | 01, 03 | 150k |
| 05 | Repo & env | Stack & standards | Vite+TS+React MV3 scaffold, Vitest, ESLint, CI | Build/test/CI verified | 03 | 150k |
| 06 | Storage | Schemas approved | Repositories + validation | Persistence tests | 03, 05 | 160k |
| 07 | Session state | State machine design | Lifecycle + restore | Transition + SW-restart tests | 06 | 180k |
| 08 | Goals & contexts | Task model, parser spec | Parser + session form logic | Parser fixtures | 07 | 160k |
| 09 | Tab monitoring | Event handling | Tabs/windows adapter, dedup | Multi-window tests | 03 (threat model), 07 | 180k |
| 10 | Idle | Idle behaviour | `chrome.idle` integration | Idle/locked tests | 09 | 100k |
| 11 | Rule classifier | Rules, confidence, topic packs | Pure classifier | ≥40-example fixture suite | 08, 09 | 200k |
| 12 | Timeline | Aggregation, retention | Timeline + pruning | Ordering/accuracy tests | 09, 11 | 140k |
| 13 | Side panel | Panel states | React side panel | Keyboard/SR/responsive | 07 (05 for build) | 200k |
| 14 | Integration | Integration review | Panel ↔ session ↔ monitor | Full scripted study session | 10–13 | 200k |
| 15 | Gentle alerts | Timing, message bank | Notifications + in-panel | Cooldown/cap tests | 14 | 160k |
| 16 | Strict overlay | Overlay + override design | Content-script overlay | Escape/countdown/fallback tests | 15 | 200k |
| 17 | Audio | (pre-researched Day 2) | Offscreen audio, volume, escalation | Mute/fallback tests | 15 | 120k |
| 18 | Recovery | Recovery messages | Recovery assistant | Usefulness review | 14 | 120k |
| 19 | Optional AI | Boundary, privacy, caps | Provider interface + mock, cache | Failure/offline/no-network tests | 11 | 160k |
| 20 | Preferences | Prefs + feedback model | Settings UI, adaptive rules | Persistence + behaviour tests | 15–18 | 180k |
| 21 | Desktop MVP eval | Journey tests | Long-session simulation | False-positive review, go/no-go | 14–20 | 200k |
| 22 | Android gate | Usage-access, policy | PoC if supported | **Gate decision** | 02 note | 150k |
| 23–26 | Android **or** hardening | per gate | per gate | per gate | 22 | 4×160k |
| 27 | Security re-review | Permissions, storage, attack surface | Fixes | Security regression | 21 | 180k |
| 28 | Beta | Install guide, test plan | Real sessions (owner) | Prioritised fix list | 27 | 140k |
| 29 | Stabilise | Bug/perf review | Release blockers | Full regression, package check | 28 | 200k |
| 30 | V1 delivery | Acceptance review | Package, docs, release notes | Final review, truthful release assessment | 29 | 180k |
