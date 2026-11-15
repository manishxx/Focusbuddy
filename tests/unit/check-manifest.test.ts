import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkManifest, findDuplicateKeys, isLocalPath } from "../../scripts/check-manifest.mjs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
interface Manifest {
  [key: string]: unknown;
  permissions: string[];
  optional_host_permissions: string[];
  content_security_policy: Record<string, string>;
  action: { [key: string]: unknown; default_icon: Record<string, string> };
  side_panel: Record<string, unknown>;
  options_ui: Record<string, unknown>;
  background: Record<string, unknown>;
  commands: Record<string, { suggested_key: Record<string, string>; description?: string }>;
  icons: Record<string, string>;
}
const source = JSON.parse(read("src/manifest.json")) as Manifest;
const bank = JSON.parse(read("src/core/messages/messages.json")) as { messages: Record<string, string> };
const tooltip = bank.messages["tooltip.none"] ?? "";
const check = (m: Record<string, unknown>) => checkManifest(m, { built: false, tooltip });
const mutate = (f: (m: Manifest) => void) => {
  const m = structuredClone(source);
  f(m);
  return check(m);
};

describe("checkManifest", () => {
  it("accepts src/manifest.json", () => {
    expect(check(source)).toEqual([]);
  });

  it.each<[string, (m: Manifest) => void]>([
    ["extra permission", (m) => m.permissions.push("history")],
    ["duplicated permission", (m) => m.permissions.push("tabs")],
    ["<all_urls>", (m) => (m.optional_host_permissions = ["<all_urls>"])],
    ["CSP changed", (m) => (m.content_security_policy.extension_pages += " ")],
    ["extra CSP key", (m) => (m.content_security_policy.sandbox = "sandbox")],
    ["web_accessible_resources", (m) => (m.web_accessible_resources = [])],
    ["externally_connectable", (m) => (m.externally_connectable = {})],
    ["host_permissions", (m) => (m.host_permissions = ["https://*/*"])],
    ["minimum_chrome_version", (m) => (m.minimum_chrome_version = "116")],
    ["extra action key", (m) => (m.action.default_popup = "popup.html")],
    ["wrong tooltip", (m) => (m.action.default_title = "Hi")],
    ["extra side_panel key", (m) => (m.side_panel.extra = true)],
    ["options_ui open_in_tab false", (m) => (m.options_ui.open_in_tab = false)],
    ["background extra key", (m) => (m.background.persistent = true)],
    ["extra command", (m) => (m.commands.other = { suggested_key: {}, description: "x" })],
    ["suggested_key extra platform", (m) => (m.commands["mute-and-pause"]!.suggested_key.mac = "Command+Shift+M")],
    ["suggested_key changed", (m) => (m.commands["mute-and-pause"]!.suggested_key.default = "Alt+M")],
    [
      "command without description",
      (m) => {
        const cmd = m.commands["mute-and-pause"];
        if (cmd) delete cmd.description;
      },
    ],
    ["remote icon", (m) => (m.icons["16"] = "https://x.example/i.png")],
    ["parent-dir icon", (m) => (m.action.default_icon["32"] = "../icon.png")],
    ["extra icon size", (m) => (m.icons["64"] = "icons/icon64.png")],
    ["version in source", (m) => (m.version = "1.0.0")],
  ])("rejects %s", (_name, f) => {
    expect(mutate(f).length).toBeGreaterThan(0);
  });
});

describe("isLocalPath", () => {
  it.each(["icons/icon16.png", "a.png"])("accepts %s", (p) => expect(isLocalPath(p)).toBe(true));
  it.each([
    "https://x/a.png",
    "//x/a.png",
    "/abs.png",
    "../a.png",
    "icons/../a.png",
    "data:image/png;base64,AA",
    "a\\b.png",
    "",
    5,
  ])("rejects %s", (p) => expect(isLocalPath(p)).toBe(false));
});

describe("findDuplicateKeys", () => {
  it("finds none in the real manifest", () => {
    expect(findDuplicateKeys(read("src/manifest.json"))).toEqual([]);
  });
  it("finds top-level and nested duplicates", () => {
    expect(findDuplicateKeys('{"permissions":["tabs"],"a":{"b":1,"b":2},"permissions":["history"]}')).toEqual([
      "$.a.b",
      "$.permissions",
    ]);
    expect(findDuplicateKeys('{"x":[{"k":1,"k":2}]}')).toEqual(["$.x[0].k"]);
  });
  it("treats escaped keys by their value", () => {
    expect(findDuplicateKeys('{"a":1,"\\u0061":2}')).toEqual(["$.a"]);
  });
  it("throws on malformed JSON", () => {
    expect(() => findDuplicateKeys('{"a":1,}')).toThrow(SyntaxError);
    expect(() => findDuplicateKeys('{"a":1} x')).toThrow(SyntaxError);
  });
});
