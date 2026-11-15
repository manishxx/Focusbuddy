# Focus Buddy — UX and accessibility guidelines (V1)

| Field | Value |
|---|---|
| Status | **v1.0, approved Day 04** after an independent cognitive-load and WCAG 2.2 AA review (23 findings, all applied; D-018) |
| Inputs | PRD v1.0 (J1–J10, FR-I*, FR-P*, BR-*, AC-05/07/08/13/16/24/27/29/30/31/32), ARCHITECTURE v1.0, API_CONTRACTS **v1.1**, DATA_MODEL **v1.1**, FEASIBILITY SD-3/6/9/11 |
| Message bank | [`docs/ux/messages.json`](ux/messages.json) is the source of truth for **every** user-facing string, and [`docs/ux/banned-phrases.json`](ux/banned-phrases.json) is the lint list (AC-31) |
| Prototypes | `prototypes/day04/` (static and throwaway). Where a prototype and this document disagree, this document wins |

---

## 1. Design principles applied to screens

| # | Principle (PRD §2) | What it means on screen |
|---|---|---|
| U1 | Companion, not surveillance | Talk about the *task*, never about the person's behaviour: "This tab doesn't look related", not "You got distracted". While a check-in is waiting, the panel doesn't name the site that looked unrelated. No list of "bad" sites anywhere. |
| U2 | Don't interrupt when unsure | `unsure` is shown quietly in the panel only. No badge change, sound, notification, **or screen-reader announcement** (§4). |
| U3 | Low cognitive load | One primary action per screen. An alert shows **at most 3 buttons plus "More options"**. Alerts are ≤ 15 words; panel text is ≤ 25 words (lint-enforced). While a check-in card is shown, the normal session controls are hidden, so there are no duplicate buttons. |
| U4 | Control is absolute | From every alert surface the user can dismiss, mute, pause and stop in one step: **one action** on the panel, overlay and intervention page; **one click to the full set** from a notification (SD-6). Nothing is ever gated by a timer. Every destructive step has one inline confirm. |
| U5 | People differ | Mode, sound, volume, cooldowns per mode, overlay, private text, quiet hours, incognito and shortcut duration are all settings. Defaults are the gentlest reasonable values. |
| U6 | Calm time | Time left is shown in whole minutes ("2 h 14 min left") and updates each minute. No ticking seconds, no red as the end approaches. |

## 2. Surfaces

| Surface | File | When it's used |
|---|---|---|
| Toolbar action (badge, tooltip, right-click menu) | manifest + SW | Always. The only surface that is guaranteed to be visible |
| Side panel | `sidepanel.html` | Main assistant UI. The user opens it, because Chrome needs a gesture |
| Welcome / settings | `options.html` (`#welcome` on first run) | First run, preferences, privacy |
| Intervention page | `intervention.html` | Full action set when the panel is closed (SD-3); opened by a notification click or an L2 fallback |
| Native notification | SW | Start notice, L1/L2 alerts, break over, "Continue your session?". Max 2 buttons (SD-6); may be invisible on macOS (SD-9) |
| In-page overlay | `content/overlay.ts` | Strict L3 only, opt-in, needs host permission |

Native notifications can be hidden without any error (Day 02 M3/M6), so **every alert also changes the badge and the panel**. Sound is never the only signal (NFR-8).

### 2.1 Toolbar badge, tooltip and menu

| Session state / status | Badge | Tooltip key |
|---|---|---|
| No session | (none) | `tooltip.none` |
| ACTIVE (any status except drifted) | `ON` | `tooltip.active` / `.generic` |
| ACTIVE · drifted (alert delivered) | `?` | `tooltip.checkin` |
| PAUSED | `II` | `tooltip.paused` / `.generic` |
| PAUSED · awaitingContinue | `II` | `tooltip.awaitingContinue` |
| ON_BREAK | `BRK` | `tooltip.break` |
| Muted | unchanged | adds `tooltip.mutedSuffix` |

- **Private notifications** on → the `.generic` tooltip variants (no task name; the tooltip can show during screen sharing).
- The SW can't read the browser theme, so badge colours are **fixed**: `ON` teal `#0b6e69`, `?` amber `#8a5a00`, `II`/`BRK` slate `#4a5560`, all with white text (5.9–7.6:1 text-on-badge). Against a light toolbar the badges reach 5.3–6.8:1. Against a dark toolbar they may fall below 3:1 (the re-review estimated 1.6–2.7 on assumed colours), so **the badge's meaning is carried by its text (`ON`, `?`, `II`, `BRK`), never by its fill colour**. The tooltip and panel say the same thing in words. Real toolbar colours are checked on Day 05 (UX-6).
- **Right-click menu** (FR-I11, AC-29, `contextMenus`):
  - "Open Focus Buddy"
  - "Pause session" or "Resume session"
  - "Add 15 minutes"
  - "Mute all and pause ▸ 15 min / 1 hour / Rest of session"
  - "End session…"

  Items that don't apply are hidden, not greyed out. A context-menu click is a user gesture, so "End session…" opens the side panel at the inline confirm. If that fails, it opens the intervention page at the confirm. It never ends the session directly.
- **Keyboard shortcut** `Alt+Shift+M` = mute all and pause for `prefs.shortcutMuteMin` (default 60). One confirmation notification (`mute.shortcut`, or `mute.shortcut.rest` when the duration is "rest of session"), badge `II`. Pressing it again while muted changes nothing (idempotent).

## 3. Flows

Each flow lists the copy keys (from `messages.json`) and the commands (API_CONTRACTS v1.1 §3). **Every UI action maps to a command; every displayed value comes from the snapshot or a command reply.**

### F1 First run (J1): 3 screens, about 45 s of reading
Every screen shows "Step N of 3", Back, and the `label.help` link in the footer (§7 consistent help).
1. **Welcome.** Heading "A focus companion for your browser". Three points: *Helps you start, notice drift and come back. · Everything stays on this computer. · Not a medical device.* **Next**.
2. **What Focus Buddy can see** (≤ 70 words of body text). It quotes Chrome's install warnings word for word:
   - *"Read your browsing history"*: "Focus Buddy reads the title and site of your current tab, only while a session is running. Titles are checked, then forgotten."
   - *"Display notifications"*: "Used for gentle check-ins." Button **Send a test notification** (`notify.test`), then `onboarding.seen.question` with Yes / No. The answer goes to `prefs.update {notificationsSeen}`. "No" shows `onboarding.seen.no` and the short macOS steps, and raises the `notifications_unavailable` notice (FR-I10).
   - "Never: page content, typing, forms, or private windows (unless you turn that on)."
3. **How should it check in?** (resolves PRD OQ-6: we ask, with Gentle pre-selected). Radio cards in a `fieldset`:
   - **Gentle (recommended)**: "A quiet notice. No sounds, no pop-ups."
   - **Adaptive**: "Starts gentle. Gets a little firmer if a check-in is missed."
   - **Strict**: "Sound and an optional full-page reminder."

   **Play sample sound** (`audio.sample`) and a volume slider appear when Adaptive or Strict is chosen. Primary **Start my first session**; secondary **Finish setup**. Skipping keeps Gentle.

Optional permissions (overlay host access, incognito) are **not** requested during onboarding. They're requested only when the user turns on the feature that needs them (BR-8, SD-2).

### F2 Create a session (J2)
1. **Empty state.** Heading "What are you working on?". One multi-line field labelled "Describe your task, how long, and which sites you'll use", with a visible example line under the field (not only a placeholder). Primary **Set up session** (`parse.intent`).
2. **Confirm form** (FR-T2: nothing is inferred silently), `confirm.title` / `confirm.help`.
   - **Visible:** Task · Goal · Length (number field, plus chips named "30 minutes", "60 minutes"…, with radio semantics) · Sites (removable chips + "Add a site").
   - **`label.moreDetails` (collapsed):** Keywords · Check-in style (pre-set from preferences) · Next step (optional, "What's the very first thing you'll do?").
   - **Only parser output is pre-filled.** Next step starts empty (PRD §3).
   - Parser warnings sit **next to the field** they affect (border + icon + text, linked with `aria-describedby`): `parse.durationDefaulted`, `parse.durationClamped`, `parse.untilPassed`.
   - Primary **Start session** (`session.start`); **Back** keeps the text (3.3.7).
3. **Conflict:** if a session is already running (AC-29), show `session.alreadyActive` with **Keep current session** (primary, focused) and **End it and start this one**.
4. **On start:** start notification (`start.title`, `start.body` / `.generic`), badge `ON`, active view (AC-32).

**Time-to-first-session target (PRD §10):** ≤ 60 s from the empty state to Start, with the sentence typed or pasted. Onboarding is measured on its own and should take ≤ 45 s.

### F3 Productive work (J3): panel active view
- **Status line**: icon + words (§4).
- **Task** (large) and **Goal** (editable inline, FR-S7, `session.updateNote`).
- **Time left** `label.timeLeft` + thin progress bar (`aria-hidden`; no colour change near the end).
- **Next step** (editable).
- **Muted line** when `mutedUntil` is set: `mute.status` + **Unmute** button (`mute.set {minutes: 0}`) → `mute.off`.
- **Controls:** **Take a break**, **Pause**, **More options ▾** (Add 15 minutes · Mute · View what's recorded · End session…).
- **Context line** (small text): `context.now` / `context.private` / `context.privateWindow` / `context.browserPage`, from `currentContextLabel`. **Hidden while a check-in is waiting** (U1). Never a title.

### F4 Drift and interventions (J4)

| Level | Channels | Copy | Visible buttons (≤ 3) | More options |
|---|---|---|---|---|
| L1 nudge (Gentle, Adaptive start) | badge `?` + panel card + notification if allowed | `nudge.l1[*]` rotated; `nudge.repeat` for Gentle's single repeat (BR-4) | Back to task · This is relevant · Take a break | Mute · End session… |
| L2 (Adaptive step 2, Strict first) | + `requireInteraction` notification + sound (unless muted or quiet hours) | `alert.l2.title`, `alert.l2.body` / `.noNext` / `.generic` | same | same |
| L3 overlay (Strict, opt-in) | + in-page overlay; fallback L2 + intervention page + `overlay_unavailable_page` notice | `overlay.*` | Back to task · This is relevant · Continue anyway | Take a break · Mute · End session… |

- **Notifications** carry 2 buttons: **Back to task** and **This is relevant**.
  - **This is relevant** from a notification opens the intervention page at the "relevant" step. A notification can't show the words step.
  - A body click focuses the window and tries `TryOpenSidePanel`; otherwise it opens the intervention page (SD-3). The intervention page shows the panel card plus `intervention.closeHint`.
- **Back to task:** `intervention.respond {back}`.
- **Continue anyway:** `intervention.respond {continue}`. It dismisses this episode, with no further alert until the cooldown, and never counts as "ignored".
- **This is relevant** (J8; panel and intervention page):
  1. `relevant.preview {interventionId}` replies `{host, mixedUse, suggestedWords?}`.
  2. The card `relevant.title` shows:
     - non-mixed host: `relevant.host`;
     - mixed-use host (YouTube, Reddit…): `relevant.words`, with a text field `relevant.wordsLabel` pre-filled with `suggestedWords` and the hint `relevant.wordsHelp`.
  3. The checkbox `relevant.remember` (unchecked) comes **before** the button **Count it**.
  4. One command, `session.addRelevant {interventionId, words?, remember}`, then `relevant.confirm` / `relevant.confirmHost` stating exactly what was allowed.

  A private site or private window shows `relevant.notAvailable` and no button (exclusion wins). `suggestedWords` is read from the live title. Unticked, the words live in `ActiveState.sessionOverrides` and are deleted at session end. Ticked, they're saved in `overrides.global`, the only title text ever saved (D-015 exception for overrides). The copy (`relevant.wordsHelp`, `privacy.neverSaved`) says exactly this.
- **End session…** from any alert surface opens one inline confirm, `stop.confirm`, with **Keep going** focused (primary) and **End session**.
- Alerts never name the "bad" site, never count time away, and never use red.

### F5 Overlay (Strict L3, FR-I6, AC-05)
- **A top-layer modal `<dialog>` opened with `showModal()`** inside a closed shadow root. This makes the page inert for both pointer and assistive technology (a `role="alertdialog"` + `aria-modal` div is **not** enough: the Day 04 review found the page still exposed in the accessibility tree). If `showModal()` isn't available, fall back to the L2 notification and intervention page, not a half-modal overlay.
- **Semantics:** `role="alertdialog"`, labelled by the title, described by the body. Screen readers hear it once.
- **Text:** generic by default (`overlay.title.generic`, FR-I12). The task label is used only if the user turns off Private notifications *and* turns on "Show task name on full-page reminders".
- **Countdown** (5 s default, 5–10): a short "pause moment" (`overlay.countdown`).
  - Nothing is locked during it. At 0 the line changes to `overlay.countdownDone`.
  - It never auto-dismisses or auto-navigates.
  - The number is `aria-hidden`. With `prefers-reduced-motion`, only the number shows (no ring animation, no fade).
- **Take a break and Mute** open small inline chip choosers inside the dialog (`overlay.breakChooser` 5/10/15; `overlay.muteChooser` 15 min/1 hour/rest of session). They send `overlay.response` with `breakMinutes` / `muteMinutes`. A content-script click can't open the side panel, so the panel is never needed.
- **This is relevant** in the overlay:
  - On a **non-mixed** host it adds a host-only, session-only override and closes the overlay with `relevant.confirmHost`.
  - On a **mixed-use** host (YouTube, Reddit…, the usual Strict case) it never allows the whole host, because that would undo FR-C3. The overlay closes with `overlay.relevantHandoff`, and the SW opens the intervention page at the words step (`tabs.create` needs no gesture). The intervention is recorded as answered `relevant` only when the user completes that step. If they don't, nothing is allowed.
- **End session…** uses the same inline confirm inside the dialog.
- **Focus:**
  - Focus starts on **Back to task**. Tab order follows the visual order.
  - Focus stays inside the dialog, and **Escape always closes it** and returns focus.
  - Switching or closing the tab always works.
- **Clicks** are honoured only when `isTrusted` (API_CONTRACTS §4).

### F6 Recovery (J5, FR-R1/R2, AC-07)
- Panel only (no notification, no sound). The card `recovery.*` picks, in order, the next-step note, the last relevant tab title (live, never stored), then the goal. Badge back to `ON`.
- **Return to last tab** (`recovery.focusLastTab`) appears when `recovery.lastRelevantTabAvailable` is true.
- The card **stays until the next status change or until the user dismisses it**. Nothing disappears while it's being read.

### F7 Break (J6, BR-2, BR-3, AC-08)
1. **Take a break:** chooser with action buttons "5 minutes" / "10 minutes" / "15 minutes" + "Other (1–60 min)". Choosing starts the break at once (`break.start`).
2. **Panel during the break:** `break.started` with the end time, then **End break now** (`break.end`) and **Add 5 minutes** (`break.extend {5}` → `break.extended`).
3. **Break over:** notification `break.over.title` / `break.over.body` (`.generic`), with buttons **Back to task** (`break.end`) and **5 more minutes** (`break.extend {5}`).
   - If it's ignored, it repeats once after 5 min, then stays silent (BR-3). The panel shows the same prompt until the user acts.
4. If the break would run past the session end, the chooser shows `break.shortened` (BR-2).

### F8 Absence auto-pause: "Continue your session?" (BR-1 amended, AC-32)
- After LOCKED > 10 min or IDLE > 30 min the session auto-pauses (badge `II`, `tooltip.awaitingContinue`).
- **On return:** one notification `continue.title` / `continue.body` with **Continue session** (`session.continue`) and **Open Focus Buddy**. There is deliberately **no End button** in the notification, because on macOS the buttons sit under "Options" and a misclick would be destructive.
- **Panel card** `continue.panel`, using `awaySince` from the snapshot. The single neutral mention of time away is allowed by D-018, because it explains why the session paused. Buttons: **Continue session** (primary), **Change length** (Add time chooser), **End session…** (inline confirm).
- No escalation and no repeat of the notification. The prompt waits in the panel.

### F9 Pause, mute, add time, end (FR-S6, FR-I11, BR-7)
- **Pause:** immediate; panel "Paused" view with time left frozen; **Resume** is primary.
- **Mute:** chooser 15 min / 1 hour / Rest of session, plus a checkbox `label.alsoPause`. Confirmation `mute.on` (or `mute.onPaused`). Visual check-ins continue unless the session is also paused (BR-7). **Unmute** is always on the active view while muted.
- **Add time:** "Add 15 minutes" / "Add 30 minutes" / "Add 60 minutes" (`session.extend`). Hitting the 480 min limit shows `extend.capped`.
- **End session…:** one inline confirm with **Keep going** focused, then ENDING → summary.

### F10 Summary (J7, FR-H3, AC-14)
- Heading `summary.title`, then plain sentences, not a dashboard:
  - `summary.time`.
  - `summary.recoveries.one` / `.many`. With 0 recoveries the line is left out, never "0 times".
  - `summary.away` (idle/locked time shown separately, neutrally, BR-1).
  - Checkbox `summary.objective` (`summary.setObjectiveDone`).
  - Collapsed **Details**: relevant sites with minutes, then "Other sites: N min" as one line (`otherMinutes`; other hosts aren't stored).
- Buttons **Start another session** (primary) and **Done**. No scores, grades, streaks or comparisons with past sessions.

### F11 Privacy: settings, "View what's recorded", delete (J9, FR-H4, FR-H6)
Settings sections, each with a one-line explanation:
- **Check-in style.**
- **Timing:** drift threshold; recovery threshold; **cooldown per mode** (Gentle ≥ 10, Adaptive ≥ 5, Strict ≥ 3 min); hourly and session caps; idle threshold.
- **Sound:** on/off, tone, volume, sample.
- **Full-page reminder:** a toggle that requests the permission with a user gesture. If denied, show `settings.overlayDenied` with **Try again**. While the permission is held, a **Remove website access** button (`permissions.remove` + `permissions.changed`) is shown.
- **Notifications:** Private notifications, test notification.
- **Keyboard shortcut:** duration (`shortcutMuteMin`).
- **Quiet hours.**
- **Private windows:** `settings.incognito` with `settings.incognitoHelp`. It only works if Chrome also allows the extension in incognito (FR-M5); otherwise the toggle explains how.
- **Private sites:** built-in categories read-only; user list editable.
- **Remembered "relevant" pages:** `overrides.list/remove`, `settings.noOverrides`.
- **History:** retention 0–90 days.
- **AI:** "Not available in this version".
- **Data.**

**View what's recorded** (`recorded.view`): a plain table "What's saved right now" with each site's minutes and class, then overrides and past summaries. `privacy.neverSaved` above it.

**Delete all data** is a native modal `<dialog>`:
- It lists exactly what DATA_MODEL §6 deletes: sessions, history, remembered pages, the current session, and the site access permission.
- Checkbox "Also reset my settings", unchecked. When ticked, it shows `delete.resetWarning`, because the user's private-site list lives in settings.
- `delete.sessionRunning` when a session is active.
- **Cancel** has default focus. **Delete everything** has the destructive style.
- Confirmation: `delete.done` / `delete.doneReset`.

## 4. Panel status line

| `status` / `attention` | Icon (shape, not only colour) | Copy key | Announced? |
|---|---|---|---|
| on_task | filled circle | `status.on_task` | no |
| unsure / drift_pending | open circle | `status.unsure` | **no** (U2) |
| drifted | speech bubble | `status.drifted` | yes (via the alert card) |
| recovering | arrow back | `status.recovering` | yes |
| excluded | shield | `status.excluded` | no |
| IDLE / LOCKED / BROWSER_UNFOCUSED | moon / lock / window | `status.idle` / `status.locked` / `status.unfocused` | no |
| PAUSED / awaitingContinue | pause bars | `status.paused` | yes |
| ON_BREAK | cup | `status.break` | yes |

- The visible status line is **not** a live region.
- A separate visually hidden `role="status"` element receives text only for rows marked "yes", and only when the announced text changes. This keeps tab switching silent for screen-reader users, the same as for everyone else.
- The intervention card uses `role="alert"` once when it appears; later updates to the same card are not re-announced.

## 5. Copy rules (FR-I8, AC-31)

1. **Voice.** Second person, present tense, plain words. Aim for text a 12-year-old can read: short words, short sentences.
2. **Length.** Alerts ≤ 15 words; everything else ≤ 25 words; one idea per sentence (lint-enforced).
3. **Name the task, not the behaviour.** ✔ "{task} is waiting". ✘ "You've been on YouTube for 6 minutes".
4. **Questions are offers.** ✔ "Ready to continue?" ✘ "Why are you here?"
5. **No exclamation marks in alerts.** Never "?!" or "!!".
6. **No counting or comparing.** Never count time away, compare with past sessions or grade. **Single exception (D-018):** the absence auto-pause card states "away for about N min" once, because it explains a pause the user didn't ask for. The summary reports idle time neutrally.
7. **No clinical words.** No treat, cure, therapy, symptom or diagnose. Don't name the condition in the product. Focus Buddy is not a medical device.
8. **Warm, brief recovery.** No over-praise.
9. **Rotate variants.** The same L1 text never appears twice in a row.
10. **Truncate user text.** User placeholders are truncated with "…": `{task}` 40, `{objective}` 60, `{nextStep}` 80, `{lastTitle}` 60, `{words}` 60 characters. Private notifications use `.generic`. The lint requires a `.generic` sibling for every notification or tooltip string that uses `{task}`.
11. **No hard-coded copy.** Every string, including button labels, lives in `messages.json` (169 keys on Day 04) and passes `lint-messages.mjs`. The lint checks banned patterns (also on a letter-spacing-normalised copy), word limits, generic leaks and generic siblings, and runs a self-test of 31 known-bad and 12 known-good strings plus an allow-scope probe. It moves into CI on Day 05 (AC-31).
12. **No UI jargon.** Not "classification", "segment", "excluded", "LIKELY_IRRELEVANT". Say "private site", "check-in".

## 6. Visual design tokens

- **Type:** system font stack only (CSP `font-src 'self'`). Base 16 px, line height 1.5; panel min width 320 px.
- **Contrast:** tokens have light and dark values (`prefers-color-scheme`). Body text ≥ 4.5:1; large text, UI boundaries and icons ≥ 3:1 (1.4.3, 1.4.11). Day 04 measured: lowest text 5.88 light / 7.68 dark; lowest boundary 4.04 / 4.57.
- **Colour:** calm palette, blue-teal primary, amber for check-ins, slate for paused. **No red** except the destructive "Delete everything".
- **Never colour alone** (1.4.1): every status has an icon shape and text.

## 7. Accessibility requirements (WCAG 2.2 AA, FR-P4, NFR-8, AC-13, AC-30)

| Area | Rule |
|---|---|
| Keyboard | Everything is operable by keyboard, in visual order. The only focus containment is in the modal dialogs; Escape always closes them (2.1.1, 2.1.2). Escape also closes any open "More options" disclosure and returns focus to its button |
| Focus | Visible ring ≥ 2 px at ≥ 3:1, never removed (2.4.7). Sticky elements never cover the focused element (2.4.11). An inline confirm focuses its **safe** button. A new card moves focus to its heading only when the user's own action caused it |
| Targets | Every target ≥ 24 × 24 CSS px, including links (padded) and checkboxes/radios (sized 24 px) (2.5.8); primary buttons 44 px tall |
| Names and roles | The visible label is the accessible name (2.5.3), e.g. "30 minutes", not "30". **Action buttons are plain buttons**; selection chips use radio-group semantics. Icon-only buttons have `aria-label` and a tooltip |
| Structure | One `h1` per page; landmarks; lists for chips; `fieldset`/`legend` for radio groups |
| Forms | Labels above fields; warnings and errors next to the field via `aria-describedby` (3.3.1, 3.3.2) |
| Live updates | As in §4. Time left is not a live region |
| Dialogs | Native `<dialog>` with `showModal()` (overlay, delete). Focus returns to the opener on close |
| Timing | No action is gated by time; the overlay countdown locks nothing (2.2.1) and lasts ≤ 10 s (2.2.2). Nothing auto-dismisses while it may be read |
| Motion | `prefers-reduced-motion` removes the ring animation, fades and progress transitions |
| Reflow | Works at 320 px wide and at 200 % zoom without horizontal scrolling (1.4.4, 1.4.10) |
| Dragging | No drag-only interactions (2.5.7) |
| Consistent help | The `label.help` link sits in the **footer of every page type**: panel, settings, intervention page, onboarding (3.2.6) |
| Redundant entry | The confirm form keeps the user's text on Back (3.3.7) |
| Auth | No login, so 3.3.8 doesn't apply |

## 8. Cognitive-load checklist (re-checked at Day 13 and Day 27)

- [ ] One primary action per screen, visually distinct.
- [ ] ≤ 3 visible buttons in any alert (+ More options); ≤ 4 visible fields on the confirm form.
- [ ] Time to first session ≤ 60 s from the empty state; onboarding ≤ 45 s.
- [ ] Defaults work without changing anything.
- [ ] Every destructive action has one confirm with the safe option focused, on every surface, including notifications and the context menu.
- [ ] Nothing disappears while the user may be reading it.
- [ ] No jargon (§5 rule 12).
- [ ] Usability prototypes pre-fill only what the parser would produce.

## 9. Open items

| # | Item | Where it's decided |
|---|---|---|
| UX-1 | Whether a "5 minutes left" heads-up is wanted (not in PRD) | Day 28 beta feedback |
| UX-2 | Final sound tones (one built-in tone is P0) | Day 17 |
| UX-3 | Exact Chrome install-warning wording on Chrome 120 vs 157 | Day 05 (with V1–V8) |
| UX-4 | Real VoiceOver pass (none was possible on Day 04; only the accessibility tree was inspected) | Day 13 panel, Day 27 a11y |
| UX-5 | `showModal()` from a content-script shadow root: top layer + page inert in real Chrome | Day 05 (ARCH §13 V8) |
| UX-6 | Chrome's real light/dark toolbar colours vs the badge fills | Day 05 |
