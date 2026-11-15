# Day 04 — Session B: Static clickable prototypes

**Goal:** Clickable HTML/CSS mocks of every V1 screen from UX_GUIDELINES v0.1.
**Agents/models:**
- Implementer: subagent, `model: opus` (exact version unknown). 167,487 tokens reported, 37 tool uses, about 24 min.
- Brief, axe harness and checks: Principal Architect, Claude Opus 5.5.

## Files (`prototypes/day04/`, throwaway; no build tooling, opens from file://)
- `index.html`: the gallery and badge/tooltip table.
- `onboarding.html`: F1, three steps.
- `panel.html`: 37 states with `#state` deep links.
- `intervention.html`, `overlay.html` (Strict L3 in a shadow root), `notifications.html` (mock renders).
- `options.html`: settings, "View what's recorded", the Delete dialog.
- Shared: `styles.css` (light and dark tokens), `proto.js`, `messages.js` (generated from the bank).
- Checks: `check-console.mjs` (implementer), `axe-check.mjs` (architect).
- `axe-core` 4.14.0 (released 2026-10-05, exact pin) was added to the throwaway spike harness `spikes/day02-feasibility/harness`. It's free from npm; no paid service.

## Implementer deviations (accepted, to be folded into v1.0 or the bank)
- Copy:
  - "only" was dropped from the onboarding text (banned minimiser).
  - The continue notification uses "Continue session".
  - The mute-shortcut notification says "60 min".
  - The L1 notification title is "Focus Buddy".
- Panel:
  - The "Now:" label is hidden while drifted, so the panel never names the site that looked unrelated.
  - "Extend 15 min" in More acts straight away.
- Implementation shortcuts:
  - Onboarding is a separate page here; the real one is `options.html#welcome`.
  - The overlay uses an open shadow root and doesn't check `isTrusted` (prototype only).
- Strings used in the prototypes but missing from the bank were listed and are added in Session C.

## Tests (actually run)
| Check | Result |
|---|---|
| `node prototypes/day04/lint-messages.mjs` | PASS: 81 strings; self-test 5/5 |
| Remote URLs in prototypes (`grep -rnE "https?://"`) | no matches |
| `node prototypes/day04/check-console.mjs` (implementer's run) | PASS: 0 errors on 7 pages + 37 states; no remote requests; no overflow at 320 px. Overlay focus, Escape and focus return pass; delete dialog defaults to Cancel. One flaky puppeteer "frame detached" on the first run; a retry was added and the final run passed without a retry |
| `node prototypes/day04/axe-check.mjs` (architect's run, axe-core 4.14.0, WCAG 2.0/2.1/2.2 A+AA tags) | **172 runs, 0 violations**, 0 horizontal scroll, 0 console errors. 1 "incomplete" (needs manual review): colour contrast on `overlay.html` (translucent scrim) |

Not run: a real screen reader (VoiceOver), 200 % browser zoom.

## Next action
Session C: independent cognitive-load and WCAG 2.2 AA review.
