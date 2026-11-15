# Feature registry

Statuses: `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `IMPLEMENTED` · `TESTED` · `REVIEWED` · `DONE`.
Requirement IDs refer to [docs/PRD.md](../docs/PRD.md). The acceptance criteria are the PRD's requirement text plus the linked AC-xx.

| Feature | Description | Pri | Reqs / AC | Planned day | Agent | Status | Files | Tests | Review | Deps | Commit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-000 | Product requirements (PRD) | P0 | all | 01 | Architect | REVIEWED | docs/PRD.md | n/a (doc) | Day 01 independent subagent review (APPROVE WITH CHANGES; all 17 findings applied) | — | Day 01 commit |
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
| F-021 | Android feasibility study | P1 | FR-D1 | 02 (desk), 22 (gate) | Architect | NOT_STARTED | — | — | — | — | — |
| F-023 | Adaptive mode rules | P1 | FR-I4 | 20 | Tier 2 | NOT_STARTED | — | — | — | F-011, F-017 | — |
| F-024 | Network-silence guarantee (no requests without AI opt-in) | P0 | NFR-5, AC-10 | 14, 21 | Tier 2 | NOT_STARTED | — | — | — | F-003 | — |
| F-025 | Browser-unfocused neutral state | P1 | FR-M8 | 09 | Tier 2 | NOT_STARTED | — | — | — | F-003 | — |
| F-022 | Android companion | P2 | FR-D2 | 23–26 (gated) | Tier 2 | NOT_STARTED | — | — | — | F-021 gate | — |
