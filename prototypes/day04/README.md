# Day 04 prototypes (throwaway)

Static HTML/CSS/vanilla-JS mocks of every V1 screen in `docs/UX_GUIDELINES.md` (v1.0). Where a prototype and that document disagree, the document wins. All copy comes from `messages.js` except headings, field labels and the strings listed in the Day 04 report. There's no build step, no npm, no network, and no remote fonts or images.

## How to open
Open `index.html` in Chrome straight from disk (`file://`). Every page links back to the gallery.

## Files
| File | Shows |
|---|---|
| `index.html` | Gallery, side-panel deep links, toolbar badge/tooltip table (§2.1), "How Focus Buddy works" help target |
| `onboarding.html` | F1: 3 steps, quoted Chrome warnings, mock test notification with the "No" path, mode radio cards, sample sound |
| `panel.html` | 360px side-panel frame. **Prototype controls** (its own `aside` landmark, outside the frame) pick any of 46 states; `panel.html#state-id` deep-links one. Buttons inside the frame move between states |
| `intervention.html` | F4 full action set for when the panel is closed, the "This is relevant" words step (`#relevant`), and an inline End-session confirm |
| `overlay.html` | F5 Strict overlay on a fake "Top 10 Football Goals" page: a native `<dialog>` opened with `showModal()` inside a shadow root, with inline break and mute choosers |
| `notifications.html` | Static drawings of each native notification and what the badge and panel show alongside |
| `options.html` | F11 settings, permission-denied path, "View what's recorded", Delete all data dialog |
| `styles.css` | Tokens (light + dark), focus ring, targets, reduced motion |
| `proto.js` | `FB.t(key, vars)` (placeholder fill, array index or rotation, user text truncated per §5 rule 10), Escape-closes-disclosure handler, icon sprite, state switching, disclosures, chip groups, WebAudio tone |
| `messages.js` | Generated from `docs/ux/messages.json` by `gen-messages.mjs`. Don't edit it by hand |
| `lint-messages.mjs` | Banned-phrase lint for the bank |
| `check-console.mjs` | Headless smoke check: console errors, remote requests, 320px overflow, every panel state, overlay `:modal` and focus, panel Escape/End-session focus, delete dialog |
| `axe-check.mjs` | axe-core run over every page and panel state (owned by the orchestrator) |

Run the check with `node prototypes/day04/check-console.mjs` from the repo root. It uses the `puppeteer-core` already installed in `spikes/day02-feasibility/harness`.

## Prototype shortcuts (not how the product will work)
- The overlay uses an **open** shadow root so automated tools can inspect it. The real one is closed. The prototype also accepts untrusted clicks; the real one honours `event.isTrusted` clicks only.
- The overlay opens when the page loads. "Show the full-page reminder again" reopens it.
- Times, minutes and summary numbers are fixed sample values. The time left doesn't tick.
- Notifications, permission prompts, closing a tab and switching tabs are simulated with "Prototype:" status text.
- Onboarding is its own page here. In the product it's `options.html#welcome`.
- The confirm form doesn't validate or parse. "Set up session" always goes to the filled form.
- Headings, field labels and a few button labels are written in the page, not taken from the bank (see the Day 04 report for candidate bank strings).

## Known spec differences (Day 04 re-check)
- Overlay "This is relevant" on a mixed-use site: the spec (UX_GUIDELINES v1.0 F5) hands off to the intervention page words step. This prototype still shows the host-only path.
- Some static labels are hard-coded here although the bank now has keys for them. The real UI uses the bank.
