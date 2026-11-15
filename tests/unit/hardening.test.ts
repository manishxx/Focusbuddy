import { describe, expect, it, vi } from "vitest";
import { DIAG_KEY, harden, type HardeningApi } from "../../src/shell/hardening";

function fakeApi(fail: { access?: boolean; panel?: boolean; session?: boolean } = {}) {
  const calls: string[] = [];
  const api: HardeningApi = {
    storage: {
      local: {
        setAccessLevel: vi.fn((o: { accessLevel: string }) => {
          calls.push(`access:${o.accessLevel}`);
          return fail.access ? Promise.reject(new TypeError("nope")) : Promise.resolve();
        }),
      },
      session: {
        set: vi.fn((items: Record<string, unknown>) => {
          calls.push(`session:${JSON.stringify(items)}`);
          return fail.session ? Promise.reject(new Error("x")) : Promise.resolve();
        }),
      },
    },
    sidePanel: {
      setPanelBehavior: vi.fn((b: { openPanelOnActionClick: boolean }) => {
        calls.push(`panel:${String(b.openPanelOnActionClick)}`);
        return fail.panel ? Promise.reject(new RangeError("no")) : Promise.resolve();
      }),
    },
  };
  return { api, calls };
}

describe("harden", () => {
  it("restricts storage.local and opens the panel on action click", async () => {
    const { api, calls } = fakeApi();
    await expect(harden(api, "evaluate")).resolves.toEqual([]);
    expect(calls).toEqual(["access:TRUSTED_CONTEXTS", "panel:true"]);
  });

  it("is idempotent across repeated evaluations", async () => {
    const { api, calls } = fakeApi();
    await harden(api, "evaluate");
    await harden(api, "startup");
    expect(calls).toEqual(["access:TRUSTED_CONTEXTS", "panel:true", "access:TRUSTED_CONTEXTS", "panel:true"]);
  });

  it("records error codes (names only) and still runs the other step", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { api, calls } = fakeApi({ access: true, panel: true });
    const errors = await harden(api, "evaluate");
    expect(errors).toEqual(["E_STORAGE_ACCESS_LEVEL:TypeError", "E_SIDE_PANEL_BEHAVIOR:RangeError"]);
    expect(calls).toContain(`session:${JSON.stringify({ [DIAG_KEY]: errors })}`);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("survives a failing diagnostics write", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { api } = fakeApi({ access: true, session: true });
    await expect(harden(api, "evaluate")).resolves.toEqual(["E_STORAGE_ACCESS_LEVEL:TypeError"]);
    warn.mockRestore();
  });
});
