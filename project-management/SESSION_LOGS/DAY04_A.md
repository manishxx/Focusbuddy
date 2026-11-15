# Day 04 — Session A: UX flows, screens, message bank

**Goal:** Design every V1 screen and flow, and the copy, before prototyping.
**Agents/models:** Principal Architect, Claude Opus 5.5 (main session). UX design is a Tier 1 gate (the user-facing contract), so it wasn't delegated.

## Outputs
- `docs/UX_GUIDELINES.md` v0.1: principles U1–U6, surfaces, badge/tooltip table, flows F1–F11, panel status table, copy rules, tokens, WCAG 2.2 AA table, cognitive-load checklist.
- `docs/ux/messages.json`: 81 strings, including `*.generic` variants for Private notifications (FR-I12).
- `docs/ux/banned-phrases.json`: 23 patterns (shame, blame, minimisers, scoring, clinical claims, punctuation).
- `prototypes/day04/lint-messages.mjs`: banned-phrase lint with a built-in self-test; `gen-messages.mjs` copies the bank for the prototypes.

## Decisions
- **PRD OQ-6 resolved:** onboarding asks for the check-in style, with Gentle pre-selected; skipping keeps Gentle.
- Onboarding quotes Chrome's install warnings word for word and includes a **test notification + "Did you see it?"** step, because Day 02 showed granted notifications that never appeared (SD-9).
- Optional permissions (overlay host access, incognito) are asked only when the feature is turned on (BR-8, SD-2).
- Recovery is panel-only (no notification, no sound).
- The overlay countdown is a "pause moment" that locks nothing and never auto-dismisses.
- Time left is shown in whole minutes; no red near the end.

## Tests
- `node prototypes/day04/lint-messages.mjs`: **PASS**, 81 strings checked, self-test 5/5 known-bad strings caught.

## Next action
Session B: static clickable prototypes (delegated to an implementer subagent).
