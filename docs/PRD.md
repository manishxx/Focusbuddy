# Focus Buddy — Product Requirements Document (V1)

| Field | Value |
|---|---|
| Status | **v1.0: approved baseline (Day 03).** Later changes need a decision-log entry |
| Owner | Principal Architect (Claude Opus 5.5) |
| Last updated | 2026-11-15 (Day 01) |
| Scope | Chrome extension (Manifest V3). Android companion is a separate gated track (§8). |

---

## 1. Purpose

Focus Buddy is an assistant that runs in your browser. It helps people who have
ADHD-related trouble with attention and executive function (planning, starting and
finishing tasks) to start a task, keep it in mind, notice when they have drifted, and
come back to it, without feeling watched.

**It is not a medical device.** It does not diagnose, treat or cure ADHD. Product
copy must never claim clinical effects.

### 1.1 Goals
- G1: Turn a plain-language intention into a structured focus session in under 60 seconds.
- G2: Notice likely distraction from browser context, with few false alarms.
- G3: Help the user get back on task with as little effort as possible.
- G4: Leave the user in control: they can always pause, stop, mute and dismiss.
- G5: Be useful with AI turned off and with no network.
- G6: Keep all behavioural data on the device unless the user explicitly opts in.

### 1.2 Non-goals (V1)
- Monitoring native desktop applications, other browsers, or incognito (unless the user enables incognito).
- Inferring mental attention, mood or diagnosis.
- Blocking or forcing: no locking sites, no preventing uninstall, no alarms the user can't silence.
- Camera, microphone, screenshots, keystrokes, page body text, form contents.
- Accounts, cloud sync, or remote storage for the desktop product.
- Chrome Web Store publication (needs separate authorization).
- iOS (separate research item).

---

## 2. Users and design principles

**Primary persona:** a university student with attention and executive-function
difficulties (diagnosed or not), studying in Chrome for 1–4 hours with a mix of
learning sites and sites that are both useful and distracting (for example YouTube).

**Secondary persona:** a knowledge worker doing deep-work blocks in the browser.

**Principles**
1. **Companion, not surveillance.** Supportive tone, no shame or guilt.
2. **Don't interrupt when unsure.** A false alarm costs more trust than a missed distraction.
3. **Low cognitive load.** One main action per screen, short copy, few steps to set up.
4. **User control is absolute.** Every intervention has mute, pause, stop and dismiss within one action.
5. **People with ADHD are not all alike.** Intensity, sound, timing and wording are all configurable.
6. **Deterministic first, AI last.** AI is optional and only used for ambiguous cases.

---

## 3. Reference scenario

> "I want to finish the first four chapters of Pattern Recognition today. I have three
> hours. I'll be using Claude, Google Classroom, Google Scholar, and YouTube. Help me
> stay focused and intervene when I get distracted."

The parsed session, which the user confirms before monitoring starts:

| Field | Value | Source |
|---|---|---|
| Task | Study Pattern Recognition | parser |
| Objective | Finish chapters 1–4 | parser |
| Duration | 180 min | parser (`three hours`) |
| Allowed sites | claude.ai, classroom.google.com, scholar.google.com, youtube.com | known-site dictionary |
| Topic keywords | pattern recognition (+ user additions, optional topic pack / AI expansion) | parser + user |
| Mode | from preferences (default **Gentle**) | prefs |
| Next step note | empty (user may fill) | user |

| Scenario | Browser context | Expected class | Expected behaviour |
|---|---|---|---|
| A | Google Classroom doc about Pattern Recognition | RELEVANT | Nothing happens |
| B | YouTube "K Nearest Neighbors Explained" | RELEVANT (topic vocabulary) or UNCERTAIN | Nothing happens. UNCERTAIN never triggers an intervention by itself |
| C | YouTube "Top 10 Football Goals" | LIKELY_IRRELEVANT | After the drift threshold, a gentle nudge: "Looks like we've drifted away from Pattern Recognition. Ready to continue?" |
| D | Still on C, nudge ignored | LIKELY_IRRELEVANT | Escalates according to the mode (§5.5) |
| E | User returns to study material | RELEVANT | Recovery acknowledged, with the next-step reminder (§5.7) |
| F | User clicks "I'm taking a break" | n/a | Interventions paused for the break length. Timer shows the break |

**Known limit (Scenario B):** if the keyword is only "pattern recognition" and no
topic vocabulary is available, rules alone can't tell that "K Nearest Neighbors" is
relevant. It falls into UNCERTAIN, which by design does not interrupt. Topic packs,
user keywords and optional AI expansion move it to RELEVANT.

---

## 4. User journeys

| ID | Journey | Happy-path outline | Key failure / edge paths |
|---|---|---|---|
| J1 | First run | Install → welcome (3 short screens max) → explain each permission in plain words → pick default mode → done | User denies optional permission → feature degrades with an explanation, never breaks |
| J2 | Create session | Type or paste an intention → parsed fields shown in an editable form → Start | Parser can't find a duration → prefilled default (60 min), highlighted for the user to check |
| J3 | Productive work | Side panel shows task, objective, time left and a status indicator; nothing interrupts | Multiple windows, many tabs, title changes in SPAs |
| J4 | Drift | Irrelevant activity held past the threshold → intervention at the mode's level → escalation if it continues | Cooldown and rate limits; sensitive sites never inspected; overlay impossible on page → notification fallback |
| J5 | Recovery | Relevant activity resumes → short acknowledgement + next-step reminder | Flip-flopping tabs (hysteresis, §5.4) |
| J6 | Break | "I'm taking a break" → choose length (5/10/15/custom) → interventions paused → gentle "break's over?" prompt | User extends or ends the session from the prompt |
| J7 | End | Timer ends or user stops → summary (focused time, drift episodes, recoveries, objective checkbox) | Browser closed mid-session → summary still produced on next open |
| J8 | False positive | Every intervention offers "This is relevant" → domain/title pattern added to the session's allowlist; optionally remembered | Repeated false positives make Adaptive mode less aggressive |
| J9 | Privacy | Settings → view exclusions, history retention, delete all data, AI opt-in | Delete during an active session → session stops first |
| J10 | Restart | Browser or service worker restarts → active session restored with correct remaining time | Session that expired while the browser was closed → ended and summarised, not resumed |

---

## 5. Functional requirements

Priority: **P0** = needed for the V1 Definition of Done · **P1** = planned for V1, can slip if documented · **P2** = stretch / post-V1.

### 5.1 Session management
| ID | Requirement | Pri |
|---|---|---|
| FR-S1 | Create a session with task, objective, duration (5–480 min), allowed sites, topic keywords, mode, optional next-step note. | P0 |
| FR-S2 | States: `DRAFT → ACTIVE ⇄ PAUSED/ON_BREAK → ENDED`; transitions are explicit and validated. | P0 |
| FR-S3 | Remaining time is computed from persisted timestamps (wall clock minus paused intervals), never from an in-memory counter. | P0 |
| FR-S4 | Only one active session at a time. | P0 |
| FR-S5 | The session survives service-worker restarts and browser restarts (J10). | P0 |
| FR-S6 | The user can extend, pause, resume or stop at any time from the side panel and from the toolbar action. | P0 |
| FR-S7 | The objective and next-step note can be edited during a session. | P1 |

### 5.2 Task input
| ID | Requirement | Pri |
|---|---|---|
| FR-T1 | A deterministic parser extracts duration (`3 hours`, `90 min`, `1.5h`, `until 5pm`), known site names → domains, the objective (`finish/complete/read …`) and the task subject. | P0 |
| FR-T2 | Parsed output is always shown in an editable form before Start. Nothing is inferred silently. | P0 |
| FR-T3 | Bundled known-site dictionary (≥ 30 common study/work sites) mapping names to domains. | P0 |
| FR-T4 | Users can add or remove allowed domains and keywords by hand. | P0 |
| FR-T5 | Optional AI parse/expansion (one call per session creation, if AI is enabled). | P2 |

### 5.3 Activity monitoring
| ID | Requirement | Pri |
|---|---|---|
| FR-M1 | Tracks the active tab of the focused window, using tab activation, tab updates (URL/title), tab replacement (prerender/`onReplaced`), window focus changes and tab removal. Event-driven, no polling. | P0 |
| FR-M2 | Collects only: domain, tab title, URL path only where the classifier needs it (e.g. YouTube `/watch`), and timestamps. No page content, no form data, no keystrokes. No favicon fetching (the panel shows no remote favicons, to keep AC-10 true). | P0 |
| FR-M9 | Placeholder or loading titles (e.g. a bare "YouTube" during SPA navigation, an empty title) are classed UNCERTAIN and re-evaluated on the next title update. | P0 |
| FR-M3 | Uses `chrome.idle` with a configurable threshold (default 5 min) to detect active / idle / locked. Idle **pauses evidence collection**; it is never classed as distraction. | P0 |
| FR-M4 | Nothing is monitored outside an ACTIVE session. | P0 |
| FR-M5 | Incognito is not monitored unless the user enables it in Chrome *and* in Focus Buddy. Even then, incognito titles are never persisted: they are classified in memory only. | P0 |
| FR-M6 | Built-in sensitive-site exclusion list (banking, payment, auth/login, medical/health portals, private messaging, email) plus user-defined exclusions. Excluded sites: only "excluded, neutral" and a duration are recorded, never the title, URL or domain, and nothing is sent to AI. Search-result pages whose query matches a sensitive-term list are treated the same way. | P0 |
| FR-M7 | Duplicate events (e.g. repeated title updates) are de-duplicated before classification. | P0 |
| FR-M8 | Browser losing OS focus (user in another app) → state `BROWSER_UNFOCUSED`, treated as neutral; documented as a limitation. | P1 |

### 5.4 Relevance classification
| ID | Requirement | Pri |
|---|---|---|
| FR-C1 | Output classes: `RELEVANT`, `UNCERTAIN`, `LIKELY_IRRELEVANT`, `EXCLUDED`, each with a confidence and a reason code. | P0 |
| FR-C2 | The pipeline runs in order and stops at the first confident result: sensitive exclusion → user false-positive overrides → session allowlist + keyword match → known-distraction rules → cache → heuristics → (optional AI) → UNCERTAIN. | P0 |
| FR-C3 | **A site being on the allowlist does not make every page on it relevant.** For mixed-use domains (YouTube, Reddit, Wikipedia…), the decision uses the title; other allowed domains are relevant by default. | P0 |
| FR-C4 | A topic vocabulary is built at session start from user keywords, the task subject and (if available) a bundled topic pack. | P1 |
| FR-C5 | Classification results are cached per (session, normalised title, domain), with expiry. | P1 |
| FR-C6 | Hysteresis: drift starts only after the threshold (default 90 s) of continuous LIKELY_IRRELEVANT; recovery needs ≥ 20 s of RELEVANT. Brief tab peeks don't trigger anything. Thresholds are computed from persisted timestamps whenever an event or alarm wakes the worker. Because `chrome.alarms` fires at most every 30 s (Chrome ≥ 120), drift onset may be up to +30 s late. That tolerance is accepted and stated in the ACs. Recovery is evaluated on the next event or alarm after 20 s. | P0 |
| FR-C7 | The classifier is a pure function with a fixture test suite covering Scenarios A–F and ≥ 40 labelled examples. | P0 |

### 5.5 Interventions
| ID | Requirement | Pri |
|---|---|---|
| FR-I1 | Three modes: **Gentle**, **Adaptive**, **Strict**, selectable per session and as the default. | P0 |
| FR-I2 | Gentle: always at least one surface the user can see without the panel being open: a badge/icon state change, **plus** a native notification if permitted, **plus** the in-panel message if the panel is open. Optional quiet sound. No overlay. Cooldown ≥ 10 min. (`sidePanel.open()` needs a user gesture, so the panel can't be opened automatically.) | P0 |
| FR-I3 | Strict: notification with `requireInteraction`, the user's chosen sound (offscreen audio), optional in-page overlay (FR-I6), shorter configurable cooldown (minimum 3 min). "Escalation" means moving up the ladder *nudge → notification + sound → overlay (if enabled)*. There is nothing beyond the overlay. Repeats stay at the top level, subject to the caps. | P0 |
| FR-I4 | Adaptive: starts Gentle; escalates one level only after an ignored intervention; de-escalates after "This is relevant" feedback or quick recovery. Rule-based, no ML. | P1 |
| FR-I5 | The **full** action set (**Back to task**, **This is relevant**, **I'm taking a break**, **Mute**, **Stop session**) is available in the side panel and the overlay, reachable by keyboard. Native notifications are limited by the platform to 2 buttons (and macOS hides them under "Options"), so they carry **Back to task** and **This is relevant**. Clicking the notification body focuses the window and shows the full set in the panel, if it's open, or on a small extension page. | P0 |
| FR-I6 | Overlay (opt-in): buttons are usable **during** the countdown (never trapped); Escape dismisses it at once; it never blocks browser chrome; respects `prefers-reduced-motion`; countdown default 5 s (range 5–10). It needs optional host permission, requested with a user gesture when the user turns the overlay on. If permission is denied or revoked, or the page can't run content scripts, it falls back to a notification and the panel explains why. | P1 |
| FR-I7 | Fatigue limits: per-mode cooldown; a cap per hour (default 4, never more than 6 in any mode); a cap per session (default 12); quiet hours (local timezone, visual-only: no sound or overlay); no repeat alert for the same drift episode within the cooldown. | P0 |
| FR-I8 | Copy is non-judgmental, from a reviewed message bank (no "you failed", "again?!", countdown shaming). | P0 |
| FR-I9 | Audio: one built-in gentle sound with user-adjustable volume (P0); more sounds (P1). Played through an offscreen document. If playback fails, the visual channel still happens and the failure is logged. | P0 |
| FR-I10 | If notification permission is denied, or the OS suppresses notifications (Focus/DND, detected via `notifications.getPermissionLevel` where possible), interventions fall back to badge + panel + sound, and the panel tells the user once. | P0 |
| FR-I12 | "Private notifications" preference: notifications and the overlay show generic text without the task label (lock screen / screen sharing). The overlay defaults to generic text. | P1 |
| FR-I11 | Global emergency control: a `chrome.commands` keyboard shortcut ("Mute all and pause"), plus a toolbar-action menu item, both working from any tab including `chrome://` pages. Mute lasts for a user-chosen time (15 min / 1 h / rest of session). | P0 |

### 5.6 Side panel (assistant UI)
| ID | Requirement | Pri |
|---|---|---|
| FR-P1 | `chrome.sidePanel` UI shows: monitoring indicator, task, objective, time remaining, current status (on task / unsure / drifted / break / paused / idle), main controls. | P0 |
| FR-P2 | Stays usable across normal tab navigation (global panel, not per-tab). The panel's open state is per window. A second window shows the same session once the user opens the panel there. | P0 |
| FR-P3 | Toolbar badge shows when monitoring is active. | P0 |
| FR-P4 | Works with keyboard only and with screen readers; meets WCAG 2.2 AA for contrast, focus and target size. | P0 |

### 5.7 Recovery
| ID | Requirement | Pri |
|---|---|---|
| FR-R1 | When the user recovers, show a short acknowledgement and a reminder drawn from: (1) the next-step note, (2) the last RELEVANT tab title, (3) the objective. | P0 |
| FR-R2 | One-click "Return to last relevant tab" (re-focuses that tab if it still exists). | P1 |
| FR-R3 | Optional AI phrasing of the reminder. | P2 |

### 5.8 Preferences, history, summary
| ID | Requirement | Pri |
|---|---|---|
| FR-H1 | Preferences persist and are validated; invalid stored values fall back to defaults instead of crashing. | P0 |
| FR-H2 | Two-tier retention. **Tab titles and URL paths are never persisted** (classified in memory only, D-015). **Raw activity** (hosts, classes, timings) is kept only while the session is active and deleted when the summary is built. **Aggregates** (domains, classes, durations, intervention counts) are kept 30 days by default (user-configurable, 0–90). Pruning runs at session end and on browser start. | P0 |
| FR-H3 | End-of-session summary: planned vs actual time, focused time, objective done (user checkbox), and recoveries framed positively ("You came back 3 times"). Drift-episode detail is collapsed by default. No scores, grades or streak penalties. | P0 |
| FR-H4 | "Delete all data" (stops any session; clears all stores, caches, alarms and the offscreen document; resets preferences only if the user ticks that box) and per-session delete. | P0 |
| FR-H6 | "View what's recorded": shows the user exactly which data is currently stored for the active session. | P0 |
| FR-H5 | Export own data as JSON. | P2 |

### 5.9 Optional AI
| ID | Requirement | Pri |
|---|---|---|
| FR-A1 | Off by default; explicit opt-in screen naming the data sent (tab title, domain, task subject; never URLs with query strings, never page content). | P1 |
| FR-A2 | Only called for UNCERTAIN results after cache miss; per-session and per-day call caps; results cached. | P1 |
| FR-A3 | No secret API keys bundled in the extension. V1 ships a provider interface + mock provider; a real provider requires a separately approved key/backend design. | P1 |
| FR-A4 | Any AI failure (offline, timeout, rate limit) → falls back to rules result; never blocks or crashes. | P1 |

### 5.10 Android companion (gated, separate)
| ID | Requirement | Pri |
|---|---|---|
| FR-D1 | Feasibility study (usage-access permission, background limits, Play policy, sync options) delivered as a document. | P1 |
| FR-D2 | Minimal companion (join session by QR, detect permitted foreground app use, phone reminder) — **only if the Day 22 gate passes and a device is confirmed**. | P2 |
| FR-D3 | Minimal session status from phone to desktop. **Deferred**: needs a relay backend, which D-003 blocks (FEASIBILITY §5). | P2-deferred |

### 5.11 Behaviour rules (resolve edge cases)
| ID | Rule |
|---|---|
| BR-1 | Session time is wall-clock time. It **keeps running** while idle, locked or with the browser unfocused. Only PAUSED and ON_BREAK stop the session clock. Idle/locked time is reported separately in the summary. **Amended Day 03 (anti-covert-monitoring):** if the screen is locked for > 10 min or idle for > 30 min, the session auto-pauses and resumes only after the user confirms "Continue your session?". |
| BR-2 | Break length: 1–60 min (presets 5/10/15). A break that would run past the session end is cut short at the session end. |
| BR-3 | An ignored "break over?" prompt is never escalated. It is repeated at most once, after 5 min, then the session stays ON_BREAK until the user acts or the session ends. |
| BR-4 | Gentle, Scenario D: no escalation. At most one repeat nudge per drift episode, after the cooldown. |
| BR-5 | "Until 5pm": if that time has already passed today, the parser asks the user. Durations > 480 min are clamped to 480, and the form highlights the change. |
| BR-6 | Quiet hours use the device's local timezone. During quiet hours interventions are visual only. |
| BR-7 | Mute silences sound and overlay for its duration. Visual nudges continue unless the user also pauses. |
| BR-8 | Missing permissions: if a needed permission is missing, the feature that depends on it is shown as off, with a one-click "grant" button (a user gesture). Nothing crashes. |

---

## 6. Non-functional requirements

| ID | Area | Requirement (measurable where possible) |
|---|---|---|
| NFR-1 | Performance | No polling loops; classification of one event < 5 ms (rules path) on a mid-range laptop; service worker idle between events. |
| NFR-2 | Performance | Stored activity bounded: ≤ 5,000 events per session, aggregated after the session; retention enforced. |
| NFR-3 | Reliability | No duplicate interventions after a service-worker restart; state machine transitions are idempotent. |
| NFR-4 | Reliability | Fully functional offline (AI features degrade to rules). |
| NFR-5 | Privacy | No network requests at all unless AI is opted in. Verified by test. |
| NFR-6 | Privacy | Every permission explained in the UI and in docs/SECURITY.md. No permission without a documented justification. |
| NFR-7 | Security | No remote code, no `eval`, strict MV3 CSP, no bundled secrets; secret scan before every push. |
| NFR-8 | Accessibility | WCAG 2.2 AA for extension UI; full keyboard operation; reduced-motion respected; sound never the only signal. |
| NFR-9 | Cost | Zero mandatory paid inference at runtime. |
| NFR-10 | Maintainability | TypeScript strict mode; core logic (parser, classifier, policy, state machine) pure and unit-tested; ≥ 80 % line coverage on core modules. |
| NFR-11 | Compatibility | Minimum Chrome **120** (30 s `chrome.alarms` period; `sidePanel.open()` from 116; offscreen API from 109). To be confirmed on Day 2. |
| NFR-12 | Stability | An 8-hour session with ~3,000 tab events (simulated with a fake clock on Day 21) shows no unbounded growth in storage or memory, alarm-driven checks still fire, and remaining time stays within ±1 s of expected. |

---

## 7. Scope boundaries

| In V1 (P0/P1) | Explicitly out of V1 |
|---|---|
| Chrome MV3 extension, side panel, notifications, offscreen audio, optional overlay | Other browsers (Edge may work but is untested) |
| Deterministic parser, classifier, policy engine | Mandatory AI; ML-trained models |
| Local storage only | Accounts, cloud sync, remote DB |
| Optional AI provider interface + mock | Production AI backend (needs approval and budget) |
| Android feasibility doc | Android app unless Day 22 gate passes; iOS |
| Manual-install package (unpacked/zip) | Chrome Web Store listing |

---

## 8. Platform limitations (to be shown to users)

1. Focus Buddy only sees Chrome tabs. Native apps, other browsers and phones are invisible to it.
2. It can't know what you're paying attention to. "Idle" means no keyboard or mouse input, which can happen while you're reading.
3. Overlays can't appear on Chrome's own pages (`chrome://`), the Chrome Web Store, the built-in PDF viewer, other extensions' pages, `file://` pages (unless allowed), or sites blocked by enterprise policy. A notification is used instead.
7. Chrome describes the `tabs` permission at install as *"Read your browsing history"*. Onboarding quotes this exact wording and explains what Focus Buddy actually does with it.
4. Sound may not play if the system is muted, or if the browser or OS blocks it. There is always a visual alert as well.
5. If Chrome is closed, nothing is monitored. The session resumes, or ends, when Chrome reopens.
6. Title-based relevance can be wrong. That's why "This is relevant" is one click away.

---

## 9. Acceptance criteria (V1 level)

Each is verified by an automated test (**A**) or a documented manual check in real Chrome (**M**).
Automated timing tests use an injected fake clock. Real-Chrome timing checks allow +30 s on threshold onset (FR-C6).

| ID | Given / When / Then | Verif. |
|---|---|---|
| AC-01 | Given the reference sentence, when parsed, then duration = 180, allowed domains include the 4 sites, task subject contains "Pattern Recognition", objective contains "chapters 1–4" (or "first four chapters"). | A |
| AC-02 | Given an ACTIVE 180-min session, when the service worker is terminated and restarted, then state and remaining time (±1 s) are restored and no extra intervention fires. | A + M |
| AC-03 | Given Scenario A and B titles, then class ∈ {RELEVANT, UNCERTAIN} and zero interventions. | A |
| AC-04 | Given Scenario C held for longer than the drift threshold in Gentle mode, then exactly one gentle intervention containing the task name is shown within the cooldown window, and the badge changes. | A + M |
| AC-05 | Given Scenario D in Strict mode with overlay enabled, then the overlay shows its configured countdown (default 5 s), its buttons work during the countdown, Escape dismisses it immediately, and "Continue anyway" works. | A + M |
| AC-06 | Given repeated drift, then interventions never exceed the hourly or per-session cap and never come sooner than the cooldown. | A |
| AC-07 | Given recovery (Scenario E) lasting at least the recovery threshold, then a recovery message appears, using the next-step note if one exists. | A |
| AC-08 | Given "I'm taking a break" for 10 min, then no interventions fire for 10 min, and a gentle "break over" prompt follows. | A |
| AC-09 | Given a sensitive domain (e.g. a bank), then the class is EXCLUDED, no title, URL or domain is stored, and no AI call is made. | A |
| AC-10 | Given AI disabled, then the extension makes zero network requests during a full scripted session (verified by request interception in a browser-automation harness). | A |
| AC-11 | Given AI enabled with the provider failing, then the rules result is used and no error reaches the user. | A |
| AC-12 | Given "Delete all data", then any active session is stopped; all stores, caches and alarms are cleared; the offscreen document is closed; and preferences are reset only if the user chose that. | A |
| AC-13 | Given keyboard-only use, then a session can be created, paused, resumed and stopped, and every intervention dismissed. | M |
| AC-14 | Given a session ends, then the summary shows planned/actual/focused time and drift episodes. | A |
| AC-15 | Given invalid stored preferences, then defaults are used and the user is told. | A |
| AC-16 | Given monitoring is active, then the badge and the side-panel indicator both show it. | M |
| AC-17 | Given two windows, when the user switches tabs or windows, then only the focused window's active tab is evaluated, and each switch produces exactly one activity event. | A + M |
| AC-18 | Given repeated identical title updates on one tab, then a single event is recorded (dedup). Given a YouTube SPA navigation with the placeholder title "YouTube", then the class is UNCERTAIN until the real title arrives. | A |
| AC-19 | Given idle and then locked transitions, then evidence collection pauses, no intervention fires, and the summary reports idle time separately. | A + M |
| AC-20 | Given no ACTIVE session, then no activity events are recorded and no tab listeners do work beyond an early return. | A |
| AC-21 | Given incognito is not enabled, then incognito tabs produce no events. Given it is enabled, then no incognito titles are persisted. | A + M |
| AC-22 | Given an allowlisted mixed-use domain (YouTube), then the title decides (Scenarios B vs C). Given a non-mixed allowlisted domain, then it is RELEVANT. | A |
| AC-23 | Given a 10 s peek at an irrelevant tab, or flipping between relevant and irrelevant tabs every 15 s, then no intervention fires. | A |
| AC-24 | Given a `chrome://` page or a denied host permission, when Strict would show an overlay, then a notification is shown instead and the panel explains why. | A + M |
| AC-25 | Given quiet hours, then interventions are visual only (no sound, no overlay). | A |
| AC-26 | Given the global shortcut on any tab (including `chrome://`), then sound and overlays are muted for the chosen duration. | M |
| AC-27 | Given notification permission denied, then interventions still reach the user via badge and panel, and the panel says so once. | A + M |
| AC-28 | Given a session ends, then raw titles are deleted and only aggregates remain. Aggregates older than the retention period are pruned on browser start. | A |
| AC-29 | Given only one active session is allowed, when the user starts another, then they're asked to end or keep the current one. Pause, resume, extend and stop all work from the panel and the toolbar action. | A + M |
| AC-30 | Given the side panel and the intervention page, then an automated axe check reports no WCAG 2.2 AA violations, and a manual screen-reader pass (VoiceOver) can operate every control. | A + M |
| AC-32 | Given an active session, when the screen is locked for more than 10 min or input is idle for more than 30 min, then the session auto-pauses, and monitoring resumes only after the user confirms. A start notification and badge appear when any session starts. | A + M |
| AC-31 | Given every message-bank string, then it passes a banned-phrase lint (shaming/guilt list) and has been reviewed. | A |

---

## 10. Success measures (local, no telemetry)

There is no analytics backend in V1. A beta tester may share their local summary
counts by hand. Day-28 beta targets:
- Start a session in ≤ 60 s, with no help, for 4 out of 5 testers.
- Fewer than 1 false-positive intervention per hour in the reference study scenario.
- Testers say interventions felt respectful (≥ 4/5 on a short questionnaire).

---

## 11. Assumptions

1. Users install the extension themselves and agree to the `tabs`-level permission. Without it, title-based relevance can't work.
2. Chrome stable ≥ 120 on desktop (Windows/macOS/Linux/ChromeOS).
3. Study material is mostly in the browser.
4. Users will add a few keywords when the parser's topic is too narrow. Onboarding encourages this.
5. No paid AI service is used in development or runtime (owner decision, 2026-11-15). The AI feature is built against a mock provider.
6. A physical Android device is needed for any Android validation. It is not confirmed yet.

---

## 12. Open questions (owner → due)

| # | Question | Owner | Due |
|---|---|---|---|
| OQ-1 | Overlay host permission: request `<all_urls>` optionally at runtime, or rely on `activeTab`? (`activeTab` needs a user gesture, so it likely can't power an automatic overlay.) | Architect | Day 2 experiment, Day 3 decision |
| OQ-2 | `chrome.storage.local` only, or IndexedDB for activity events? | Architect | Day 3 |
| OQ-3 | Topic-pack format and size budget; which subjects to bundle in V1. | Architect | Day 11 |
| OQ-4 | Minimum Chrome version given `chrome.alarms` 30 s granularity and side-panel APIs. | Architect | Day 2 |
| OQ-5 | Does the owner have an Android device for Day 22–26? | Owner | Before Day 22 |
| OQ-6 | Default mode at first run: Gentle (proposed) or ask during onboarding? **Resolved Day 04 (D-018): ask, with Gentle pre-selected.** | UX review | Day 4 |
| OQ-7 | Does a notification click count as a user gesture for `sidePanel.open()`? (Reviewer unsure.) | Architect | Day 2 spike |
| OQ-8 | Side-panel behaviour for incognito windows in spanning mode. | Architect | Day 2 spike |

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| False positives erode trust | High | High | UNCERTAIN class never intervenes; hysteresis; one-click "relevant"; fixture suite |
| Permission warning scares users | Med | High | Plain-language explanation, local-only promise, optional host permission for overlay |
| SW termination loses timers | High | High | Persist state; `chrome.alarms`; idempotent handlers; restart tests |
| Audio blocked | Med | Low | Visual alert always shown; audio best effort |
| Android scope consumes desktop time | Med | High | Hard gate Day 22; desktop DoD independent |
| Over-engineering for a 30-day V1 | Med | Med | P0/P1/P2 discipline; architect review of abstractions |
