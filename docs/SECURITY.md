# Security and privacy: threat model (V1)

| Field | Value |
|---|---|
| Status | **v1.0, approved Day 03** after an independent adversarial review. All 17 findings applied. Required before Day 09 (monitoring) |
| Scope | Chrome MV3 extension. The Android companion is out of scope until the Day 22 gate |
| Method | Assets → trust boundaries → STRIDE-style threats → mitigations → tests |

## 1. Assets

| Asset | Sensitivity | Where |
|---|---|---|
| A1 Tab titles and URLs | **High**: can reveal searches, documents, health, finance, people | **Memory only** (D-015); never persisted |
| A2 Hosts visited during a session | High | IndexedDB `segments` (raw tier, session life) |
| A3 Session aggregates (task label, objective, minutes, relevant hosts) | Medium | IndexedDB `sessions` |
| A4 Preferences, exclusions, overrides | Low–Medium (exclusions and overrides hint at sites) | storage.local |
| A5 The ability to interrupt the user (notifications, sound, overlay) | Medium: wellbeing, trust | Runtime |
| A6 The optional host permission, once granted | **High**: script injection on any page | Runtime |
| A7 **The observed person**: the person whose browsing is observed may not be the person who started the session (shared computer or profile) | High | Policy, UX |

## 2. Trust boundaries

1. **Web pages ↔ extension.** Page content is untrusted, including titles, which pages control. It enters only via `tabs` metadata and the overlay content script. Anything the overlay renders is readable by the page.
2. **Extension contexts ↔ SW.** Trusted code, but each message is still validated, and the sender is classified with exact checks (API_CONTRACTS §2). `runtime.sendMessage` broadcasts, so non-SW contexts register no listeners.
3. **Content-script world ↔ extension storage.** By default content scripts can read `storage.local`, so it's restricted to trusted contexts at startup, and nothing sensitive is kept there (DATA_MODEL §1). Content scripts can't read IndexedDB or `storage.session`.
4. **Other extensions ↔ Focus Buddy.** Untrusted. Blocked: no `externally_connectable`, no `onMessageExternal`.
5. **Extension ↔ network.** None in V1 (§6 CSP plus lint plus the AC-10 test).
6. **Device user ↔ data at rest.** Anyone with access to the OS account or Chrome profile can read profile data, including via devtools on extension pages. Not mitigated beyond minimisation (residual R1).

## 3. Permission justification (shown in onboarding, NFR-6)

| Permission | Why it's needed | Chrome's install warning | Data minimisation |
|---|---|---|---|
| `tabs` | Read the active tab's title and URL to judge relevance (FR-M1) | *"Read your browsing history"* | Only during an active session; classified in memory; only host + class stored |
| `idle` | Detect away/locked so time away isn't counted as distraction (FR-M3); auto-pause on long absence | none | State only |
| `alarms` | Wake up to check timers (FR-S3) | none | — |
| `storage` | Save sessions and preferences locally (never `storage.sync`) | none | Local only; access level restricted |
| `sidePanel` | The assistant panel (FR-P1) | none | — |
| `offscreen` | Play reminder sounds (FR-I9) | none | No user data sent |
| `notifications` | Gentle reminders, start-of-session notice (FR-I2) | *"Display notifications"* | Text = task label + phrase, or generic text with "private notifications". **Never tab titles** |
| `scripting` | Inject the overlay into the current tab (FR-I6). Useless without the optional host permission | none | Static file only; isolated world; on demand |
| `contextMenus` | Pause/Resume, Stop, "Mute and pause" on the toolbar icon (FR-S6, FR-I11) | none | — |
| optional `http://*/*`, `https://*/*` | Show the Strict overlay on the page the user drifted to (SD-2). Requested only when the user turns the overlay on. Narrower than `<all_urls>` (no `file://`) | *"Read and change all your data on all websites"* (at request time) | Never used to read page content; removable from settings and offered on delete-all |

**Manifest also declares:** `commands` (global "Mute and pause" shortcut), `minimum_chrome_version: "120"` (provisional, SD-1), and incognito `spanning` (the default; filtered in code). **Not requested:** `history`, `webNavigation`, `webRequest`, `cookies`, `activeTab`, `unlimitedStorage`, `identity`, native messaging, `web_accessible_resources`.

## 4. Threats and mitigations

| ID | Threat | Scenario | Mitigation | Verified by |
|---|---|---|---|---|
| T1 | Disclosure | Raw activity piles up | Titles never stored; hosts only for the session; purge at end and on startup (works even in safe mode) | AC-28, invariants 1 & 3 |
| T2 | Disclosure | Sensitive sites recorded | Category-based exclusion on the **raw** URL and title, before anything is stored; normalised host/path matching (IDN, ccTLD, IP, subdomain, percent-encoding); no host stored for excluded pages | AC-09, fixture suite incl. variants |
| T3 | Disclosure | Search queries stored via results-page titles ("\<query\> - Google Search") | Titles are never persisted (D-015); the query is checked against sensitive terms in memory only | Invariant 1 test |
| T4 | Disclosure | Incognito activity persisted | Off by default. When on: host-less segments only; never updates `lastRelevant`, overrides or snapshot labels | AC-21, all-stores scan test |
| T5 | Disclosure | Data sent over the network | No network code (lint); strict CSP (§6); AI off, mock only. The CSP isn't assumed to cover the SW's `fetch` (unverified), so the lint and test are the guarantee | AC-10 (request interception) |
| T6 | Disclosure | Lock-screen or screen-share exposure of task or titles | Notifications never contain titles; "private notifications" preference for generic text; overlay text generic by default. OS notification history may outlive delete-all (documented) | Notification builder unit test |
| T7 | Disclosure | A content script or compromised renderer reads `storage.local` | `setAccessLevel(TRUSTED_CONTEXTS)` at startup (Chrome 120 support unverified); no titles, URLs or nonces in `storage.local`; nonce in `storage.session` | Startup test; storage audit test |
| T8 | Tampering / spoofing | A hostile page fakes overlay responses (synthetic events, forged messages) | `isTrusted` for keys and clicks; single-use nonce bound to `tabId` + `documentId`; isolated world; benign response set | API_CONTRACTS §4; e2e test with synthetic events |
| T9 | Tampering | Navigation between the two injection calls puts the overlay args into another document | Call 2 targets the `documentId` from call 1 | E2E navigation-race test |
| T10 | Tampering | A page title crafted to inject markup into the panel (XSS) | React text rendering only; no `dangerouslySetInnerHTML` (lint); titles truncated in memory | Lint + unit test with `<img onerror>` title |
| T11 | Spoofing | Another extension, a web page, or a look-alike path (`evil.example/offscreen.html`) messages the SW or offscreen | No external surface; exact `sender.id` + `getURL()` matching; offscreen accepts only `audio.play` from the SW; UI pages have no listeners | Router unit tests incl. look-alike URLs |
| T12 | Elevation | Host permission misused beyond the overlay | Only the static `overlay.js` is injected; no `eval`, no remote code, never `world: "MAIN"` | Code review, CSP test |
| T13 | DoS (wellbeing) | Alert storms, or an overlay the user can't escape | Global cooldown + hourly/session caps; Escape; buttons usable during the countdown; global shortcut; toolbar menu; quiet hours; mute | AC-05, AC-06, AC-26 |
| T14 | DoS | A page floods title changes | Dedup; per-tab rate limit ≥ 1 s; segment cap | Integration test |
| T15 | Integrity | SW restart duplicates interventions or corrupts state | `attemptedAt` persisted before effects; no replay of sound/overlay; `ENDING` state; idempotent reconciliation | AC-02, NFR-3 |
| T16 | Supply chain | A compromised npm dependency ships in the bundle | Minimal runtime deps; exact pins + lockfile; `npm audit` in CI; review every new dependency (Day 05 policy) | CI |
| T17 | Disclosure | Logs leak URLs or titles (Chrome error strings embed URLs; chrome://extensions → Errors; console) | Diagnostic log stores error codes only; never `lastError.message`; production strips `console.*`; no title in any thrown error | Unit test + build check |
| T18 | Disclosure (fingerprinting) | The site detects the overlay being inserted and learns the user drifted | Overlay is opt-in; generic host element and text. Residual risk, documented in onboarding | — (residual R5) |
| T19 | Tampering (clickjacking) | Page CSS hides, covers or click-traps the overlay | Top-layer `<dialog>`/popover where possible; `isTrusted` clicks; the global shortcut and toolbar menu work regardless of the page | E2E test with hostile CSS |
| T20 | Covert monitoring of another person (A7) | On a shared profile, someone starts a long silent session and later reads what was recorded | Start notification + badge + action title "Focus Buddy: session active"; **auto-pause after LOCKED > 10 min or IDLE > 30 min**, needing "Continue?"; max session 8 h; titles never stored, so later inspection shows hosts only. The incremental risk over Chrome's own history is modest | AC-16, new AC-32 |
| T21 | Disclosure | Prerendered or replaced tabs bypass exclusion | Pipeline re-runs on `tabs.onReplaced` for the new tab id | Unit test |
| T22 | Disclosure | Exported or deleted data lingers | `deleteAll` covers every store, notifications, badge, menus and offscreen (DATA_MODEL §6) | AC-12 |
| T23 | Disclosure | Chrome crash reports include in-memory titles | Unverified. Titles are held only briefly in memory. Documented as residual R6 | — |

## 5. Residual risks (accepted for V1)

- R1: Data at rest (hosts, aggregates) is unencrypted in the Chrome profile; readable by anyone with profile access.
- R2: The `tabs` permission is broad. Users must trust that we read it only during sessions. Mitigated by local-only design, open source and "View what's recorded".
- R3: Once granted, the optional host permission is powerful. Mitigated by being opt-in and easy to revoke, and by never reading pages.
- R4: Title-based classification can be wrong both ways. Mitigated by UX (one-click "relevant", UNCERTAIN never interrupts).
- R5: Sites can detect the overlay (T18).
- R6: Crash reports may contain in-memory data (T23, unverified).

## 6. Content Security Policy

```json
"content_security_policy": {
  "extension_pages": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
}
```

`connect-src 'self'` allows only the extension's own bundled files. `default-src 'none'` closes image, font, style and prefetch side channels. The CSP doesn't stop navigation or `tabs.create`/`update` to external URLs, so a lint rule restricts those calls to extension URLs and the tab ids of the user's own tabs. Whether the policy governs the SW's `fetch` is unverified (ARCH §13 V3).

## 7. Security requirements for implementation (checklist for Day 05+ reviews)

- [ ] `core/*` has no `chrome.*` imports; no `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`sendBeacon` anywhere (lint).
- [ ] Manifest CSP exactly as in §6; no `externally_connectable`, no `web_accessible_resources`.
- [ ] Every message validated against its schema; sender class checked with exact matching; no `onMessage` listener outside the SW and offscreen.
- [ ] Nothing persisted before the exclusion check; no title or path in any stored record (automated store scan in tests).
- [ ] `storage.local.setAccessLevel(TRUSTED_CONTEXTS)` at startup; nonce only in `storage.session`.
- [ ] Notification, snapshot and overlay builders never include raw titles, except the recovery suggestion shown in the panel.
- [ ] Diagnostic log: codes only. Production build strips `console.*` from observation paths.
- [ ] Secret scan before every push; no keys in the repo or bundle.
