/**
 * Service worker entry (ARCHITECTURE §2–§4). All listeners are registered
 * synchronously at the top level so Chrome can wake the worker for them.
 *
 * Start order on every evaluation: boot marker; hardening → openStorage (migrations,
 * raw purge, retention) → engine → Startup reconciliation, which is always the FIRST
 * input (src/shell/boot.ts). Alarms, idle changes and messages that arrive earlier
 * wait for the engine and queue behind Startup. If storage can't open, commands reply
 * storage_error and the next input retries initialisation.
 */
import { systemClock } from "../core/clock";
import type { SessionInput } from "../core/session";
import { chromeEffectPorts } from "./adapters/chrome";
import { supportsPersistAcrossSessions } from "./adapters/chromeVersion";
import { createBoot, writeBootMarker } from "./boot";
import { createEngine, type EngineReply } from "./engine/engine";
import { kvSnapshotPort } from "./engine/snapshotPort";
import { harden, isHardened, type HardeningApi } from "./hardening";
import { createRouter, type Reply } from "./messaging/router";
import { chromeLocalArea, chromeSessionArea } from "./storage/kv";
import { diagRepo } from "./storage/kvRepos";
import { openStorage } from "./storage/openStorage";

// Explicit wrappers: chrome APIs are only ever called directly (lint rule fb/chrome-access).
const api: HardeningApi = {
  storage: {
    local: { setAccessLevel: (options) => chrome.storage.local.setAccessLevel(options) },
    session: { set: (items) => chrome.storage.session.set(items) },
  },
  sidePanel: { setPanelBehavior: (behavior) => chrome.sidePanel.setPanelBehavior(behavior) },
};

// Runs on every evaluation of the worker: first install, browser start, and every
// wake-up after the worker was stopped (the access level is not persisted).
const ready: Promise<string[]> = harden(api, "evaluate");

/**
 * Resolves true only when storage.local is restricted to trusted contexts for this
 * worker evaluation. RULE: every future injection into a web page (the Strict overlay
 * via chrome.scripting.executeScript) must go through ONE adapter that awaits
 * `readyHardened` and refuses to inject when it is false; otherwise a content script
 * could read chrome.storage.local before the access level is applied. That adapter
 * arrives on Day 09 (ARCHITECTURE §3 shell/adapters/overlay). Registered content
 * scripts are banned by lint for the same reason.
 */
export const readyHardened: Promise<boolean> = ready.then(isHardened);

/** idle.setDetectionInterval accepts 15 s or more; prefs already enforce 15–1800. */
function setIdleInterval(seconds: number): void {
  try {
    chrome.idle.setDetectionInterval(seconds);
  } catch {
    // Not fatal: the default (60 s) stays in effect.
  }
}

// Review F2: a per-evaluation boot marker (no user data).
void writeBootMarker(chromeSessionArea(), systemClock.now()).catch(() => undefined);

// Review F11/N3: an unhandled rejection is a bug. Record a diag code (no message text,
// which could carry a URL) and let it surface in chrome://extensions → Errors as well.
addEventListener("unhandledrejection", () => {
  void diagRepo(chromeLocalArea(), () => systemClock.now())
    .append("E_UNHANDLED_REJECTION")
    .catch(() => undefined);
});

const boot = createBoot({
  init: async () => {
    await readyHardened;
    const opened = await openStorage({
      local: chromeLocalArea(),
      session: chromeSessionArea(),
      idbFactory: indexedDB,
      now: () => systemClock.now(),
    });
    try {
      setIdleInterval((await opened.repos.prefs.get()).prefs.idleThresholdSec);
    } catch {
      setIdleInterval(300);
    }
    return opened;
  },
  makeEngine: (opened) =>
    createEngine({
      repos: opened.repos,
      ports: chromeEffectPorts({ persistAcrossSessions: supportsPersistAcrossSessions(navigator.userAgent) }),
      clock: systemClock,
      newId: () => crypto.randomUUID(),
      notices: opened.notices,
      safeMode: opened.mode === "safe",
    }),
  snapshot: kvSnapshotPort(chromeSessionArea()),
  recordDiag: (code) => diagRepo(chromeLocalArea(), () => systemClock.now()).append(code),
  now: () => systemClock.now(),
});

// Start initialising now; failures are retried by the next input.
void boot.engine().catch(() => undefined);

function submit(input: SessionInput): Promise<EngineReply> {
  return boot.engine().then(
    (engine) => engine.enqueue(input),
    (): EngineReply => ({ ok: false, error: "storage_error" }),
  );
}

const router = createRouter({
  runtimeId: chrome.runtime.id,
  getURL: (path) => chrome.runtime.getURL(path),
  engine: () => boot.engine(),
  now: () => systemClock.now(),
  // Local time for "until 5pm": read here, never in the pure core (PARSER_SPEC §2).
  tzOffsetMin: () => -new Date().getTimezoneOffset(),
});

chrome.runtime.onInstalled.addListener(() => {
  // Opens nothing on install yet (onboarding arrives later). Re-applying is
  // idempotent and covers an install that races the top-level call.
  void ready.then(() => harden(api, "installed"));
});

chrome.runtime.onStartup.addListener(() => {
  void ready.then(() => harden(api, "startup"));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void submit({ kind: "alarm", name: alarm.name });
});

chrome.idle.onStateChanged.addListener((state) => {
  void submit({ kind: "idle", state, at: systemClock.now() });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (reply: Reply) => void) => {
  void router.handle(message, sender).then(sendResponse, () => sendResponse({ id: "", ok: false, error: "internal" }));
  return true; // reply asynchronously
});
