/**
 * Service worker entry (ARCHITECTURE §2, §3). All listeners are registered
 * synchronously at the top level so Chrome can wake the worker for them.
 * Day 05 scaffold: no tab, idle or alarm handling yet.
 */
import { harden, isHardened, type HardeningApi } from "./hardening";

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

chrome.runtime.onInstalled.addListener(() => {
  // Opens nothing on install yet (onboarding arrives later). Re-applying is
  // idempotent and covers an install that races the top-level call.
  void ready.then(() => harden(api, "installed"));
});

chrome.runtime.onStartup.addListener(() => {
  void ready.then(() => harden(api, "startup"));
});
