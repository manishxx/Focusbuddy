/**
 * Service worker entry (ARCHITECTURE §2, §3). All listeners are registered
 * synchronously at the top level so Chrome can wake the worker for them.
 * Day 05 scaffold: no tab, idle or alarm handling yet.
 */

/** Diagnostic codes from start-up hardening (codes only, never user data). */
export const startupErrors: string[] = [];

function record(code: string, error: unknown): void {
  const detail = error instanceof Error ? error.name : "unknown";
  startupErrors.push(`${code}:${detail}`);
  console.warn(`[focus-buddy] ${code}`, detail);
}

async function restrictStorage(): Promise<void> {
  try {
    // SECURITY §7: content scripts must not read chrome.storage.local.
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (error) {
    record("E_STORAGE_ACCESS_LEVEL", error);
  }
}

async function configureSidePanel(): Promise<void> {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    record("E_SIDE_PANEL_BEHAVIOR", error);
  }
}

async function onLifecycle(): Promise<void> {
  await restrictStorage();
  await configureSidePanel();
  if (startupErrors.length > 0) {
    try {
      await chrome.storage.session.set({ "diag.startupErrors": [...startupErrors] });
    } catch {
      // Nothing more we can do without user data; the console code above remains.
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // Opens nothing on install yet (onboarding arrives later).
  void onLifecycle();
});

chrome.runtime.onStartup.addListener(() => {
  void onLifecycle();
});
