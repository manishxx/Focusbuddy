# Day 04 — Session C: Independent cognitive-load and WCAG 2.2 AA review

**Goal:** Independent review of the UX set and prototypes, resolve the findings, then the architect's approval.
**Agents/models:**
- Reviewer: subagent, `model: opus` (exact version unknown). This is a different agent from the implementer. It reviewed twice: a full review, then a re-check of the fixes. The harness reported 183,646 and 232,314 tokens; it isn't known whether the second figure includes the first.
- Implementer (fix round): the same subagent as Session B. The harness reported 249,999 tokens for that run; whether that's cumulative is unknown.
- Resolution and approval: Principal Architect, Claude Opus 5.5.

## Results
| Round | Verdict | Blocker | Major | Minor |
|---|---|---|---|---|
| Review 1 | APPROVE WITH CHANGES | 0 | 11 | 12 |
| Re-check | APPROVE WITH CHANGES: 21 fixed, 2 partial | 0 | 1 new (N2) | 3 new (N1, N3, N4) |

All 23 original findings and the 4 new ones were resolved by the architect after the re-check. These last fixes were re-verified by running the checks, not by a third review.

## Main resolutions (D-018)
- **Every UI action now maps to a command (API_CONTRACTS v1.1):**
  - new: `relevant.preview`, `break.extend`, `recovery.focusLastTab`, `notify.test`, `audio.sample`
  - `session.addRelevant` now derives the host in the SW from `interventionId`
  - `overlay.response` gains `break` and durations
  - the snapshot gets `awaySince` and the `overlay_unavailable_page` notice
  - DATA_MODEL v1.1
- **"This is relevant":**
  - an explicit, editable "words to match" step for mixed-use sites, with Remember shown before confirming
  - from the overlay on a mixed-use site, it hands off to the intervention page instead of allowing the whole host (re-check N2; protects FR-C3)
- **Destructive steps:**
  - the "Continue your session?" notification has no End button
  - the context-menu "End session…" opens the inline confirm
  - every confirm focuses the safe button
- **Toolbar menu (AC-29):** now covers Pause/Resume and Add 15 minutes.
- **Overlay:** must be a top-layer `showModal()` dialog. The reviewer showed that `aria-modal` left the page exposed; with `showModal()` only the dialog is in the accessibility tree.
- **Screen readers:** "unsure", "on task" and "private site" changes are not announced (U2). Only drifted, recovering, paused and break are, and only when the text changes.
- **Cognitive load:**
  - confirm form shows 4 fields, with the rest under "More details"
  - at most 3 buttons plus More in any alert
  - session controls are hidden while a check-in is shown
  - the recovery card no longer fades
- **Settings:**
  - added incognito, per-mode cooldowns, tone, shortcut duration and Remove website access
  - the delete dialog now matches DATA_MODEL §6
  - Unmute is always visible
- **Lint (banned-phrases v3):**
  - more patterns
  - normalisation: invisible characters, letter or hyphen spacing, digit-for-letter swaps
  - numeric placeholders are tested
  - word limits on every key
  - `.generic` siblings are required for notification and tooltip strings
  - the allow-list works by exact substring
  - self-test: 31 bad and 12 good strings, plus an allow-scope probe
- **Copy:**
  - "only while a session is running" restored
  - no "drift" jargon in status text
  - session-only words described accurately (N1)
- **Badge:** the claim that it reaches 3:1 on dark toolbars was removed. Meaning is carried by the badge text; real toolbar colours are checked Day 05 (UX-6).

## Accepted, not changed
- **Prototype overlay "This is relevant":** it still shows the host-only path. The spec (N2 hand-off) wins, and the prototypes are throwaway; `prototypes/day04/README.md` lists the difference.
- **Prototype static text:** some labels are still hard-coded although the bank now has them. The real UI must use the bank (Day 13).
- **Re-check lint gap:** the reviewer's strings "{task }" (with a space) aren't flagged. The formatter wouldn't fill that placeholder, so it can't leak.

## Checks (final, run by the architect after the last change)
| Check | Result |
|---|---|
| `node prototypes/day04/lint-messages.mjs` | PASS: 172 strings; self-test bad 31/31, good 12/12 |
| `node prototypes/day04/check-console.mjs` | PASS: 7 pages + 46 panel states, 0 errors, 0 remote requests, no overflow at 320 px. Overlay `:modal`, focus, Escape; More-options Escape; "Keep going" focus; delete dialog |
| `node prototypes/day04/axe-check.mjs` (axe-core 4.14.0, WCAG 2.0/2.1/2.2 A+AA) | **208 runs, 0 violations**, 0 horizontal scroll, 0 console errors |
| Remote URL grep over prototypes | no matches |

Not run: a real screen reader (UX-4), Chrome's own 200 % zoom (only root font-size scaling was tried), real notifications, badge and context menu (they need the real extension).

## Approval gates passed (architect)
- UX_GUIDELINES **v1.0**, message bank and banned-phrase list v1/v3.
- API_CONTRACTS **v1.1** and DATA_MODEL **v1.1** (contract amendments, D-018).
- PRD OQ-6 resolved.

## Next action
Day 05 Session A: stack and standards. Then the scaffold, CI (including the message lint), and V1–V8, UX-3, UX-5 and UX-6 checks.
