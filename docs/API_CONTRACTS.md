# API contracts (internal messaging)

| Field | Value |
|---|---|
| Status | **v1.0, approved Day 03** after two independent reviews. All findings applied |
| Scope | Messages between extension contexts. There's no external API: no `externally_connectable`, and no `onMessageExternal` listener |

## 1. Envelope

```ts
type Request = {
  v: 1;                       // contract version
  id: string;                 // random UUID, used to match the reply and for logs
  type: CommandType;          // see §3
  payload: unknown;           // validated per type
  nonce?: string;             // required only for overlay.response (§4)
};

type Reply =
  | { id: string; ok: true; data?: unknown }
  | { id: string; ok: false; error: ErrorCode };   // codes only, never free text that could carry a URL

type ErrorCode =
  | "invalid_message" | "unknown_type" | "forbidden_sender" | "invalid_state"
  | "not_found" | "permission_missing" | "storage_error" | "internal";
```

Rules:
- Validation uses a schema per `type`. Unknown fields are rejected, strings have length caps (task label ≤ 120, objective ≤ 300, notes ≤ 500, keywords ≤ 40 × 60 chars, title substring ≤ 60), and numbers have range checks.
- A message that fails validation gets `invalid_message` and changes nothing.
- Commands are **idempotent where possible** (`session.pause` when already paused → `ok: true` with no change).
- **`runtime.sendMessage` broadcasts to every extension context**, so "only the SW receives" must be *enforced*. UI pages register **no** `runtime.onMessage` listener (lint rule). The offscreen document ignores everything except `audio.play` from the SW and returns `false` for all other messages.

## 2. Sender validation

The router classifies `chrome.runtime.MessageSender` using **exact** comparisons:

| Sender class | Recognised when | Allowed types |
|---|---|---|
| `extension_page` | `sender.id === chrome.runtime.id` **and** `sender.url` (without query or hash) is exactly `chrome.runtime.getURL(p)` for `p` ∈ {`sidepanel.html`, `options.html`, `intervention.html`} | Everything in §3 except `overlay.response` |
| `overlay` | `sender.id === chrome.runtime.id`, `sender.tab` present, `sender.frameId === 0`, `sender.documentId` equals the stored `overlay.pending.documentId` | `overlay.response` only, with a valid nonce |
| anything else, including any sender whose URL merely *ends with* an extension file name | — | none → `forbidden_sender` |

Content scripts can't forge `sender.url`: the browser sets it from the frame's committed URL. The v0.1 rule ("URL ends with `/offscreen.html`") could be matched by `https://evil.example/offscreen.html` and has been removed.

## 3. Commands (UI → SW)

| Type | Payload | Effect / reply data | PRD |
|---|---|---|---|
| `parse.intent` | `{ text: string ≤ 1000 }` | `{ draft: SessionDraft, warnings[] }`; pure, nothing stored | FR-T1, T2 |
| `session.start` | `{ draft: SessionDraft }` | Starts and shows a start notification + badge; replies `{ sessionId }`. If one is active → `invalid_state` with `{ activeSessionId }` (AC-29) | FR-S1, S4 |
| `session.pause` / `session.resume` | `{}` | State change | FR-S6 |
| `session.continue` | `{}` | Confirms "Continue your session?" after an absence auto-pause | BR-1 (amended) |
| `session.extend` | `{ minutes: 5–120 }` | Re-schedules the end alarm; total ≤ 480 | FR-S6 |
| `session.stop` | `{}` | ENDING → summary → ENDED | FR-S6, H3 |
| `session.updateNote` | `{ objective?: string, nextStep?: string }` | Updates the session | FR-S7 |
| `session.addRelevant` | `{ host: string, titleSubstring?: string ≤ 60, remember: boolean }` | Adds an override (session or global). Refused with `invalid_state` for an excluded host (exclusion wins) | FR-T4, J8 |
| `overrides.list` / `overrides.remove` | `{}` / `{ host, titleSubstring? }` | Manage remembered overrides | FR-H6 |
| `break.start` | `{ minutes: 1–60 }` | ON_BREAK (BR-2) | FR-I5 |
| `break.end` | `{}` | ACTIVE | J6 |
| `intervention.respond` | `{ interventionId, response: "back" \| "relevant" \| "break" \| "mute" \| "stop" \| "continue", muteMinutes?: 15\|60\|-1, breakMinutes?: 1–60 }` | Records the response. `back` focuses the last relevant tab if it still exists (FR-R2). Unknown or stale id → `not_found` | FR-I5 |
| `mute.set` | `{ minutes: 15 \| 60 \| -1 (rest of session) \| 0 (unmute), alsoPause?: boolean }` | Mute (BR-7). `alsoPause` = the "Mute and pause" composite | FR-I11 |
| `prefs.get` | `{}` | `{ prefs }` | FR-H1 |
| `prefs.update` | `{ patch: Partial<Preferences> }` | Validated merge; replies with the effective prefs | FR-H1 |
| `permissions.changed` | `{}` | SW re-reads `permissions.contains`; sent by a page after a gesture-based `permissions.request` / `remove` | SD-2 |
| `history.list` | `{ limit ≤ 50, before?: number }` | Session summaries (aggregate tier only) | FR-H2 |
| `summary.get` | `{ sessionId }` | `{ summary }` | FR-H3 |
| `summary.setObjectiveDone` | `{ sessionId, done: boolean }` | Sets `objectiveDone` | FR-H3 |
| `recorded.view` | `{}` | Everything stored right now: active-session segments (hosts/classes/times), overrides, history summaries | FR-H6 |
| `data.deleteSession` | `{ sessionId }` | Deletes that session's records | FR-H4 |
| `data.deleteAll` | `{ resetPreferences: boolean }` | DATA_MODEL §6 (AC-12) | FR-H4 |
| `diag.get` | `{}` | Local diagnostic log (error codes only) | ARCH §10 |

## 4. Overlay protocol

1. When the SW decides on L3, it creates `nonce = crypto.randomUUID()`.
2. **Injection call 1:** `executeScript({ target: { tabId, frameIds: [0] }, files: ["overlay.js"] })`. Record `documentId` from the returned `InjectionResult`.
3. Store `{interventionId, nonce, tabId, documentId, expiresAt = now + 2 min}` in **`storage.session`** (`overlay.pending`; trusted contexts only), not in storage.local.
4. **Injection call 2:** `executeScript({ target: { tabId, documentIds: [documentId] }, func, args: [{ nonce, interventionId, text, countdownSec }] })`. Targeting the same `documentId` means a navigation between the two calls makes call 2 fail instead of landing in a different document. Both run in the **isolated world** (never `world: "MAIN"`), so the nonce isn't visible to page scripts.
5. `text` is a generic message-bank phrase ("Time to come back to your task?"). The task label is included only if `prefs.overlay.showTaskLabel` is on (default off), because anything rendered into the page's DOM is visible to the site, even inside a closed shadow root.
6. The overlay renders in a closed shadow root. It uses a top-layer `<dialog>`/popover where available (ARCH §13 V8), so page CSS can't easily cover or hide it. It reacts to keys **and clicks** only when `event.isTrusted`. Buttons work immediately, during the countdown.
7. A response sends `{ type: "overlay.response", nonce, payload: { interventionId, response: "back" | "continue" | "relevant" | "mute" | "stop" | "dismissed" } }`. The SW accepts it only if the nonce matches, hasn't expired, and `sender.tab.id` and `sender.documentId` match. The nonce is single-use.
8. If the page navigates or the tab closes, the intervention counts as `dismissed`. A session ending removes the overlay (`RemoveOverlay`).

**What the nonce does and doesn't protect.** It stops stale or duplicated overlays, and stops responses from the wrong document. It does **not** protect against a fully compromised page renderer, which could also read whatever the overlay renders. That's why the overlay shows generic text by default, and why every response is benign: back, continue, mute, stop and relevant only affect the user's own session. Residual risks: the site can detect that an overlay appeared (fingerprinting a drift moment), and can try to visually obstruct it (SECURITY T17, T18).

## 5. SW → offscreen

| Type | Payload | Notes |
|---|---|---|
| `audio.play` | `{ tone: "chime" \| "soft" \| "bell", volume: 0–1 }` | Tones are generated with an oscillator. No file fetch is needed (works under the strict CSP). One shared AudioContext (SD-11) |

The offscreen document accepts `audio.play` only when `sender.id === chrome.runtime.id` and `sender.tab` is absent, plus an exact SW sender check once its `sender.url` is confirmed (ARCH §13 V2; fallback: a port opened by the offscreen doc). The SW creates the document on demand behind an in-flight promise guard and treats "already exists" as success.

## 6. UiSnapshot (SW → pages via `chrome.storage.session` key `ui.snapshot`)

Published **only when its content changes**.

```ts
type UiSnapshot = {
  v: 1;
  at: number;                              // epoch ms
  session: null | {
    id: string;
    state: "ACTIVE" | "PAUSED" | "ON_BREAK" | "ENDING";
    awaitingContinue: boolean;
    taskLabel: string; objective: string; nextStep?: string;
    plannedMin: number;
    endsAt: number;                        // pages compute remaining time; frozen while PAUSED
    pausedAt?: number; breakEndsAt?: number;
    mode: "gentle" | "adaptive" | "strict";
    attention: "ACTIVE_INPUT" | "IDLE" | "LOCKED" | "BROWSER_UNFOCUSED";
    status: "on_task" | "unsure" | "drift_pending" | "drifted" | "recovering" | "excluded";
    currentContextLabel?: string;          // a host, "Excluded site", "Private window" or "Browser page"; never a title or URL
    mutedUntil?: number;
    pendingIntervention?: { id: string; level: 1 | 2 | 3; message: string; createdAt: number };
    recovery?: { message: string; lastRelevantTabAvailable: boolean };   // message may contain the live title
  };
  notices: Array<{ code: "notifications_unavailable" | "overlay_permission_missing" | "storage_error" | "prefs_reset" | "safe_mode"; at: number }>;
  lastSummaryId?: string;
};
```

## 7. Versioning

`v` is bumped on breaking changes. There's no compatibility window: on an extension update Chrome reloads all extension pages, so old pages don't outlive the new SW (to be confirmed on Day 05). Any message of an unknown `v` → `invalid_message`.
