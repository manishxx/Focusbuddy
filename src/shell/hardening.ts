/**
 * Start-up hardening, applied on EVERY service-worker evaluation (not only on
 * install/startup): the reviewer showed in Chrome 157 that the storage.local
 * access level does not survive a browser restart. Both calls are idempotent.
 * Takes the chrome API surface as a parameter so it can be unit-tested.
 */

export interface HardeningApi {
  storage: {
    local: { setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void> };
    session: { set(items: Record<string, unknown>): Promise<void> };
  };
  sidePanel: { setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void> };
}

export const DIAG_KEY = "diag.startupErrors";

/** Diagnostic codes only (never user data), e.g. "E_STORAGE_ACCESS_LEVEL:TypeError". */
export async function harden(api: HardeningApi, reason: string): Promise<string[]> {
  const errors: string[] = [];
  const attempt = async (code: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      errors.push(`${code}:${error instanceof Error ? error.name : "unknown"}`);
    }
  };
  // SECURITY §7: content scripts must not read chrome.storage.local.
  await attempt("E_STORAGE_ACCESS_LEVEL", () => api.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }));
  await attempt("E_SIDE_PANEL_BEHAVIOR", () => api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
  if (errors.length > 0) {
    for (const e of errors) console.warn(`[focus-buddy] ${reason} ${e}`);
    try {
      await api.storage.session.set({ [DIAG_KEY]: errors });
    } catch {
      // Nothing more to do without user data; the console codes above remain.
    }
  }
  return errors;
}
