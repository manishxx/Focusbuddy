/**
 * Service worker entry (ARCHITECTURE §2, §3). All listeners are registered
 * synchronously at the top level so Chrome can wake the worker for them.
 * Day 05 scaffold: no tab, idle or alarm handling yet.
 */
import { harden, type HardeningApi } from "./hardening";

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

chrome.runtime.onInstalled.addListener(() => {
  // Opens nothing on install yet (onboarding arrives later). Re-applying is
  // idempotent and covers an install that races the top-level call.
  void ready.then(() => harden(api, "installed"));
});

chrome.runtime.onStartup.addListener(() => {
  void ready.then(() => harden(api, "startup"));
});
