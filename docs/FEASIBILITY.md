# Feasibility and platform limitations

| Field | Value |
|---|---|
| Day | 02 (2026-11-15) |
| Target | Google Chrome 157.0.8103.51 (stable, macOS 14.8.3) |
| Evidence | Official docs (research subagent, sources cited) + automated spike runs (`spikes/day02-feasibility/harness/results*.json`) + owner manual checklist (§4, pending) |
| Status | Automated part complete; manual part **pending owner** |

Confidence legend: **V** = verified by our own run in Chrome 157 · **Vh** = verified only in *headless* Chrome 157 (real-device behaviour may differ; a manual check is listed) · **D** = stated in official docs · **U** = unverified / inferred.
No result here has been checked on Chrome 120. Version claims below 157 rest on docs (D).

---

## 1. Chrome API findings

| # | Topic | Finding | Basis | Impact on PRD |
|---|---|---|---|---|
| 1 | `tabs` permission | `title`/`url`/`favIconUrl` are present only with `tabs` or host permission. Install warning: *"Read your browsing history"*. | D | FR-M2, §8.7 confirmed |
| 2 | Tab events | Observed `onActivated` (3), `onUpdated` with title (4), `windows.onFocusChanged` (1) in the scripted run. `onReplaced` and `onRemoved` were registered but **not exercised**. `WINDOW_ID_NONE` on macOS app switch not tested. | Vh (+ U for replaced/removed/NONE) | FR-M1 mostly confirmed; M1, M15 |
| 3 | **Transient titles** | Before a page finishes loading, Chrome reports the URL-like string (`127.0.0.1:port/page?title=…`) or `about:blank` as the title, then the real title. | V | **FR-M9 must also treat "title equals URL without scheme" and `about:blank` as placeholders** |
| 4 | Same-title reassignment | Setting an identical `document.title` twice produced one `onUpdated` title event. | V | Dedup (FR-M7) still needed for URL/title pairs across tabs, but Chrome already suppresses exact repeats |
| 5 | `chrome.idle` | `queryState` returned `active` (trivially true in headless). States: active/idle/locked. Minimum detection interval: not stated in the current reference page (commonly 15 s). macOS `locked`: not documented. | Vh / U | Manual M11, M12 |
| 6 | `chrome.alarms` | 0.5-min period accepted. In Chrome 157 alarms read back `persistAcrossSessions: true` **by default**. Docs: option exists from Chrome 150; older versions "unpredictable". Docs recommend re-checking alarms on every SW start. Whether Chrome < 150 **rejects** an unknown `persistAcrossSessions` property is unknown. | Vh (157) + D | **Re-create required alarms on every SW start. Pass `persistAcrossSessions` only behind a version check.** Behaviour on 120 = U |
| 7 | SW lifetime | Terminates after 30 s idle; events and API calls reset the timer; a single event over 5 min is killed. | D | FR-S3/S5 design: no in-memory timers |
| 8 | SW restart + alarm wake | After a forced stop, the next alarm restarted the worker. Storage and alarms survived (§3). | V | FR-S5, AC-02 feasible |
| 9 | `sidePanel` | `openPanelOnActionClick: true` setting accepted (read back). No action click was performed (M2 confirms). `sidePanel.open()` without a gesture fails: *"may only be called in response to a user gesture."* Docs list action click, shortcut, context menu and extension-page/content-script clicks as gestures. Notification clicks are **not listed**. | V + D | FR-I2/I5 confirmed. Notification click → open panel is **unproven** (M4) |
| 10 | Offscreen audio | `AUDIO_PLAYBACK` document created; `AudioContext` state `running` without a user gesture; gain value read back. This does **not** prove audible sound. Docs: closes after 30 s without audio; one document per profile. | Vh + D | FR-I9 feasible in principle; M7 confirms sound. **Create on demand behind an in-flight guard** (two concurrent alerts must not both call `createDocument`) |
| 11 | Notifications | `getPermissionLevel` = `granted` (also the install default). 2-button notification created. A 3-button request was **also accepted without error** in headless (it may be silently truncated); docs say max 2. Mac: button icons, images hidden. `getPermissionLevel` likely reflects **only Chrome's own setting**, not macOS notification settings or Focus/DND (U). | Vh + D + U | Never send more than 2 buttons (M6). **FR-I10 can't rely on `getPermissionLevel` to detect OS suppression** (M16) |
| 12 | Overlay, no host permission | `executeScript` fails: *"Extension manifest must request permission to access this host."* On `chrome://`: *"Cannot access a chrome:// URL"*. | V | FR-I6 fallback path confirmed |
| 13 | Overlay, with host permission | Using a variant build with `host_permissions` **granted at install**: injected; overlay present; **Escape removed it**; events `shown`, `escape` reached the SW. Runtime grant via `permissions.request` not exercised. | Vh | FR-I6 feasible once permission is held; M9, M10 for the runtime grant |
| 14 | `permissions.request` | Needs a user gesture (docs sample). From a side-panel button: expected to work, unverified. | D / U | Manual M9 |
| 15 | `chrome.commands` | Up to 4 suggested shortcuts. Behaviour while a `chrome://` page is focused: not documented. | D / U | Manual M8 for FR-I11 |
| 16 | `activeTab` | Granted by action click, context menu, keyboard command, omnibox. **Not** by side panel or notification. Lasts until navigation. | D | Confirms D-009: overlay needs optional host permission |
| 17 | Incognito | Default "spanning". Side panel in incognito undocumented. | D / U | Manual M13 (OQ-8) |
| 18 | Automation | `--load-extension` removed from branded Chrome 137+. **`puppeteer-core` 25.17 `enableExtensions` loaded the unpacked extension into branded Chrome 157.** | V + D | **E2E harness choice for Day 5** |

## 2. Answers to PRD open questions

| OQ | Answer | Confidence |
|---|---|---|
| OQ-1 overlay permission | Optional `<all_urls>` host permission, requested from a panel button when the user turns the overlay on. `activeTab` can't power automatic overlays. | Vh (injection once the permission is held) + D. Runtime grant U (M9) |
| OQ-4 minimum Chrome | **Provisionally 120** (`minimum_chrome_version`), based on docs only. Re-create alarms on SW start; pass `persistAcrossSessions` only on ≥ 150. **Day 5 action:** run the harness on Chrome for Testing 120. That download needs owner approval. If it isn't approved or fails, raise the floor to the oldest version actually tested. | D / U |
| OQ-7 notification click → panel | Not documented as a gesture. **Design so it isn't needed:** clicking the notification focuses the window and opens the extension's intervention page in a tab (always allowed). Try `sidePanel.open` first if M4 shows it works. | U, pending M4 |
| OQ-8 incognito side panel | Pending M13. V1 default is incognito off, so it doesn't block. | U |

## 3. Service-worker restart test (T4)
Source: `spikes/day02-feasibility/harness/results-t4.json` (run 2026-11-15T05:28Z, headless Chrome 157).

| Phase | Observation |
|---|---|
| Undisturbed 75 s | The 30 s alarm fired at +30 s and +60 s, at most 3 ms late. One SW start. The worker stayed alive (alarm events kept resetting its idle timer). |
| Forced stop (`ServiceWorker.stopAllWorkers` via CDP) | 1.5 s later: 0 service-worker targets. |
| After stop | The next alarm (+15 s) **restarted the worker** (`sw_start` logged) and its handler ran. Both alarms were still registered. All earlier `chrome.storage.local` entries were intact. |

**Contradicting earlier run (disclosed).** In `results.json` (`T4b_after_restart`),
after `Target.closeTarget` the worker target was still present 3 s later, and **no
`alarm` entries were logged in the following ~43 s**, although `tick` was registered.
Two contributing factors: that run started only ~10 s after install, and the closed
target probably left the worker in a detached state. The cause is **not established**.
This is why the clean `t4-restart.mjs` run is used as evidence. Restart tests from
Day 5 on must reproduce the clean result, not assume it.

**Observer effects (U).** Puppeteer was connected to the browser and an extension
page (`sidepanel.html`) was open as the log reader. The claim that alarm events kept
the worker alive is inferred. **Natural 30 s idle termination was never observed**
(the 30 s alarm prevents it), and `stopAllWorkers` is a forced stop, not natural
termination. Storage survival rests on 10 log entries read after the stop; no count
was taken before it. Day 7 restart tests will record before/after counts.

**Conclusion (Vh, forced stop only):** alarms wake a terminated worker, and persisted storage survives.
The FR-S5 / AC-02 design (persist everything, recompute from timestamps on every
wake) is feasible. Browser-restart persistence is pending manual check M14.

**Harness note:** `Target.closeTarget` reports success but doesn't stop an
extension worker. Use `ServiceWorker.stopAllWorkers` in Day 5+ restart tests.

## 4. Manual verification (owner)
Checklist: [`spikes/day02-feasibility/MANUAL_CHECKLIST.md`](../spikes/day02-feasibility/MANUAL_CHECKLIST.md). **Status: not yet run.**
Items M3–M8 and M11–M14 can't be automated in this environment.

---

## 5. Android companion: desk feasibility (input to Day 22 gate)

| Question | Finding | Basis |
|---|---|---|
| Detect foreground app use | `UsageStatsManager.queryEvents` with `PACKAGE_USAGE_STATS`. The user grants it in Settings → Usage access (special access, not a runtime dialog). It's pull-only: the app must query periodically. | D |
| Running during a session | A foreground service is required. On Android 14+ it must declare a type; `specialUse` fits, with a justification reviewed in Play Console. It can't be started from the background, but starting it from a visible activity (user taps "Join session") is allowed. | D |
| Notifications | `POST_NOTIFICATIONS` runtime permission on Android 13+. If denied, the FGS notification is hidden from the drawer. | D |
| Play policy | Accessibility-service misuse is restricted (we won't use it). No restricted-permission declaration for `PACKAGE_USAGE_STATS` was found on official pages. A prominent in-app disclosure is still planned. | D / U |
| Sync with desktop | No backend is allowed under D-003. The options are below. | Analysis |
| iOS | Screen Time APIs (FamilyControls / DeviceActivity) need a special entitlement. Separate research item, out of V1. | U |
| Local tooling | Android Studio, SDK platform-tools (`adb`) and bundled JBR are installed. **No physical device confirmed (OQ-5).** | V (Day 0) |

**Sync options (architect assessment)**

| Option | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. One-way QR join | The side panel shows a QR code with `{sessionId, label, endsAt, mode}`. The phone scans it and runs a mirror session until `endsAt`. | No backend, offline, minimal data, no pairing secrets kept | The desktop doesn't see phone distractions (no back-channel) | **Recommended if the gate passes** |
| B. Relay backend | Phone and extension talk through a hosted relay | Two-way status | New infrastructure and an auth/privacy surface; blocked by D-003 | Only with owner approval and budget |
| C. LAN connection | The extension connects to a server on the phone | No cloud | Discovery, mixed-content/permission problems, fragile across networks | Rejected |

**Option A design gaps to resolve if chosen:**
- Send `issuedAt` plus a duration, not only an absolute `endsAt`, so clock skew between devices doesn't matter.
- Desktop pause, stop and extend don't reach the phone. Offer "re-scan to update" and document it.
- The task `label` is user content. It stays optional, and nothing else from the session goes into the QR code.

**Desk verdict:** a minimal Android companion (Option A: join by QR, usage-access
detection, phone reminders) is *technically feasible*. A realistic estimate is
**about 6–10 days** (uncertain): a new Kotlin project, usage-access onboarding, a
`specialUse` foreground service with Play review of unknown latency, QR scanning,
and notifications. That is more than the 4 days (23–26) available. **Hard gate:** a
physical Android device must be confirmed before Day 22. Without one, Android is
reported as *deferred*. With one, the likely outcome is *prototype-only*. "Minimal
session status to the desktop" (part of FR-D2) is moved to P2-deferred in the PRD,
because it needs Option B.

---

## 6. Scope decisions (Day 02)

| ID | Decision |
|---|---|
| SD-1 | Minimum Chrome **provisionally** 120 (docs only; Day 5 test on 120 pending owner approval). All required alarms are re-created idempotently on every SW start. `persistAcrossSessions` is passed only on Chrome ≥ 150. |
| SD-2 | Overlay host permission is optional `<all_urls>`, requested from a panel button when the user turns the overlay on. Denied → notification fallback. |
| SD-3 | Notification click → focus the window and open the intervention page (tab), with `sidePanel.open` as a best-effort first try. |
| SD-4 | Offscreen audio document is created on demand for each alert. Code assumes it may already be closed. |
| SD-5 | Placeholder titles (URL-like, `about:blank`, bare site name, empty) are UNCERTAIN and re-checked on the next update (extends FR-M9). |
| SD-6 | Native notifications never get more than 2 buttons. |
| SD-7 | E2E harness: `puppeteer-core` + `enableExtensions` against locally installed Chrome. CI uses Chrome for Testing (decided Day 5). |
| SD-8 | Android: Option A only, if the Day 22 gate passes **and** a device is confirmed. Expected outcome is at most prototype-only. The desktop back-channel is deferred unless the owner approves a backend. |
| SD-9 | FR-I10 doesn't rely on `getPermissionLevel` for OS-level suppression. Interventions always use badge + panel as well as the notification. |
| SD-10 | FR-I11's toolbar-menu item needs the `contextMenus` permission (install warning: none). Added to the Day 3 permission review. |

## 7. Spike patterns that must NOT carry into production

The spike code is throwaway and deliberately crude. Day 5+ code must not copy these:

1. **Over-collection.** `sw.js` stores the full `url` (with query strings) and `title` for every tab, including incognito, plus `tabUrl` on commands. Production follows FR-M2, M5, M6 and H2: domain plus the minimal path, nothing from incognito or excluded sites, and raw data only for the session.
2. **No sender validation.** `onMessage` accepts commands from any extension context, including injected content scripts, which could call `injectOverlay` on any tab or `clearLog`. Production: an allowlist of commands per sender type, checks on `sender.id` and `sender.url`, and schema-validated payloads.
3. **Untrusted keyboard events.** The overlay's Escape handler doesn't check `e.isTrusted`, so a page could fake a dismissal. Production: check `isTrusted` and treat page-originated events as hostile.
4. **Offscreen race.** `ensureOffscreen` has no in-flight guard.
5. **Harness shortcuts.** It uses the private `target._targetId` and minimal HTML escaping. Test code only, never production.
