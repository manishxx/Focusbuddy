# Feature registry

Statuses: `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `IMPLEMENTED` · `TESTED` · `REVIEWED` · `DONE`.
Requirement IDs refer to [docs/PRD.md](../docs/PRD.md). The acceptance criteria are the PRD's requirement text plus the linked AC-xx.

| Feature | Description | Pri | Reqs / AC | Planned day | Agent | Status | Files | Tests | Review | Deps | Commit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-000 | Product requirements (PRD) | P0 | all | 01, 03 | Architect | DONE (v1.0 baseline approved Day 03) | docs/PRD.md | n/a (doc) | Day 01 review (17 findings) + Day 03 architect approval | — | Day 03 commit |
| F-001 | Session lifecycle & state machine | P0 | FR-S1–S6, BR-1–3, AC-02, AC-08, AC-29 | 07 | Tier 2 | NOT_STARTED | — | — | — | F-010 | — |
| F-002 | Natural-language task parser | P0 | FR-T1–T4, AC-01 | 08 | Tier 2 | NOT_STARTED | — | — | — | F-001 | — |
| F-003 | Tab/window activity monitor | P0 | FR-M1, M2, M4, M5, M7, M9, AC-17, 18, 20, 21 | 09 | Tier 2 | NOT_STARTED | — | — | — | F-001, threat model | — |
| F-004 | Idle-state detection | P0 | FR-M3, AC-19 | 10 | Tier 2 | NOT_STARTED | — | — | — | F-003 | — |
| F-005 | Sensitive-site exclusions | P0 | FR-M6, AC-09 | 09–11 | Tier 2 | NOT_STARTED | — | — | — | F-003 | — |
| F-006 | Rule-based relevance classifier | P0 | FR-C1–C3, C6, C7, AC-03, AC-22, AC-23 | 11 | Tier 2 + Architect review | NOT_STARTED | — | — | — | F-002, F-003 | — |
| F-007 | Topic vocabulary / packs & cache | P1 | FR-C4, C5 | 11 | Tier 2 | NOT_STARTED | — | — | — | F-006 | — |
| F-008 | Activity timeline & retention | P0 | FR-H2, NFR-2, NFR-12, AC-28 | 12 | Tier 2 | NOT_STARTED | — | — | — | F-003 | — |
| F-009 | Side panel assistant UI | P0 | FR-P1–P4, FR-S7 (P1), AC-13, AC-16, AC-30 | 13 | Tier 3 UI + Tier 2 review | NOT_STARTED | — | — | — | F-001 | — |
| F-010 | Local persistence layer | P0 | FR-H1, FR-S5 | 06 | Tier 2 | NOT_STARTED | — | — | — | architecture | — |
| F-011 | Intervention policy engine (modes, cooldowns, caps, quiet hours) | P0 | FR-I1–I3, I7, BR-4, 6, 7, AC-04, AC-06, AC-25 | 15 | Tier 2 + Architect review | NOT_STARTED | — | — | — | F-006 | — |
| F-012 | Native + in-panel notifications, global mute shortcut | P0 | FR-I2, I5, I8, I10, I11, AC-26, AC-27, AC-31 | 15 | Tier 2 | NOT_STARTED | — | — | — | F-011 | — |
| F-013 | Strict in-page overlay (opt-in) | P1 | FR-I6, AC-05, AC-24 | 16 | Tier 2 | NOT_STARTED | — | — | — | F-011, OQ-1 | — |
| F-014 | Audio alerts (offscreen): one sound + volume P0, extra sounds P1 | P0 | FR-I9 | 17 | Tier 2 | NOT_STARTED | — | — | — | F-011 | — |
| F-015 | Recovery assistant (FR-R2 "return to tab" is a P1 sub-item) | P0 | FR-R1, AC-07 | 18 | Tier 2 | NOT_STARTED | — | — | — | F-006 | — |
| F-016 | Optional AI adapter (mock provider) | P1 | FR-A1–A4, AC-11 | 19 | Tier 2 + Architect gate | NOT_STARTED | — | — | — | F-006 | — |
| F-017 | Preferences persistence & validation | P0 | FR-H1, BR-8, AC-15 | 20 | Tier 2 | NOT_STARTED | — | — | — | F-011 | — |
| F-018 | Session summary | P0 | FR-H3, AC-14 | 20–21 | Tier 3 + review | NOT_STARTED | — | — | — | F-008 | — |
| F-019 | Privacy controls, data deletion, "view what's recorded" | P0 | FR-H4, FR-H6, AC-12 | 20 | Tier 2 | NOT_STARTED | — | — | — | F-010 | — |
| F-020 | Onboarding & permission explanations | P0 | J1, NFR-6 | 13–20 | Tier 3 + review | NOT_STARTED | — | — | — | F-009 | — |
| F-021 | Android feasibility study | P1 | FR-D1 | 02 (desk), 22 (gate) | Architect | IN_PROGRESS (desk note done Day 02; gate Day 22) | docs/FEASIBILITY.md §5 | n/a | Day 02 subagent review | OQ-5 device | Day 02 commit |
| F-023 | Adaptive mode rules | P1 | FR-I4 | 20 | Tier 2 | NOT_STARTED | — | — | — | F-011, F-017 | — |
| F-024 | Network-silence guarantee (no requests without AI opt-in) | P0 | NFR-5, AC-10, SECURITY §6 CSP | 14, 21 | Tier 2 | NOT_STARTED | — | — | — | F-003 | — |
| F-025 | Browser-unfocused neutral state | P1 | FR-M8 | 09 | Tier 2 | NOT_STARTED | — | — | — | F-003 | — |
| F-022 | Android companion | P2 | FR-D2 | 23–26 (gated) | Tier 2 | NOT_STARTED | — | — | — | F-021 gate | — |
| F-026 | Architecture set (ARCHITECTURE, API_CONTRACTS, DATA_MODEL, SECURITY, ADR-0001..0006) | P0 | all | 03 | Architect | DONE (approved Day 03) | docs/*.md, docs/DECISIONS/* | n/a (doc) | 2 independent reviews Day 03 (38 findings applied) | F-000 | Day 03 commit |
| F-029 | UX & accessibility design set (UX_GUIDELINES, message bank, banned-phrase lint, static prototypes) | P0 | FR-I8, FR-P4, NFR-8, AC-30, AC-31, J1–J10 | 04 | Architect + Tier 2 | DONE (approved Day 04) | docs/UX_GUIDELINES.md, docs/ux/*, prototypes/day04/ | lint PASS; axe 0 violations; console checks PASS | 1 independent review Day 04 (23 findings applied) | F-026 | Day 04 commit |
| F-030 | Repo scaffold, build, guards, CI (ADR-0007) | P0 | NFR-5, NFR-7, NFR-10, AC-10 (rehearsal), AC-31 | 05 | Tier 2 + Architect | DONE (approved Day 05) | package.json, scripts/*, src/**, tests/**, .github/workflows/ci.yml | 228 unit tests; e2e smoke; platform probe; GitHub CI | 1 independent review + re-check Day 05 | F-026 | Day 05 commits |
| F-027 | Absence auto-pause + session-start indicator (anti-covert-monitoring) | P0 | BR-1 (amended), AC-32, D-016 | 07, 10 | Tier 2 | NOT_STARTED | — | — | — | F-001, F-004 | — |
| F-028 | Private notifications preference | P1 | FR-I12 | 15, 20 | Tier 3 | NOT_STARTED | — | — | — | F-012 | — |
