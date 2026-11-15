/**
 * Proves the ADR-0007 project lint rules fire, by linting small snippets with
 * ESLint's Node API under file paths in each scope. The files need not exist.
 */
import { fileURLToPath } from "node:url";
import { ESLint, type Linter } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
let eslint: ESLint;

beforeAll(() => {
  // The probe files are virtual, so let the TypeScript project service treat them
  // as "default project" files type-checked with the real tsconfig.json. The rules
  // under test come unchanged from eslint.config.js.
  eslint = new ESLint({
    cwd: root,
    overrideConfig: {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: ["vitest.config.ts", "src/*/__lint_probe__.ts", "src/ui/*/__lint_probe__.tsx"],
            defaultProject: "tsconfig.json",
          },
        },
      },
    },
  });
});

async function lint(code: string, filePath: string): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${filePath}` });
  if (!result) throw new Error("no lint result");
  return result.messages;
}

const CORE = "src/core/__lint_probe__.ts";
const SHELL = "src/shell/__lint_probe__.ts";
const UI = "src/ui/sidepanel/__lint_probe__.tsx";
const OFFSCREEN = "src/offscreen/__lint_probe__.ts";

type Case = [name: string, file: string, code: string, rule: string];

const BAD: Case[] = [
  // core purity (ADR-0001)
  ["core imports chrome", CORE, `import "chrome";\nexport const a = 1;`, "no-restricted-imports"],
  ["core imports shell", CORE, `export { x } from "../shell/engine";`, "no-restricted-imports"],
  [
    "core imports shell (deep)",
    CORE,
    `import { x } from "../../src/shell/adapters/tabs";\nexport const y = x;`,
    "no-restricted-imports",
  ],
  [
    "core imports ui",
    CORE,
    `import { PRODUCT_NAME } from "../ui/shared/product";\nexport const n = PRODUCT_NAME;`,
    "no-restricted-imports",
  ],
  ["core uses chrome global", CORE, `export const q = () => chrome.tabs.query({});`, "no-restricted-globals"],
  ["core uses globalThis.chrome", CORE, `export const q = () => globalThis.chrome;`, "no-restricted-properties"],
  ["core uses fetch", CORE, `export const f = () => fetch("/x");`, "no-restricted-globals"],
  // network (NFR-5, ADR-0005)
  ["fetch", SHELL, `export const f = () => fetch("/x");`, "no-restricted-globals"],
  ["XMLHttpRequest", SHELL, `export const f = () => new XMLHttpRequest();`, "no-restricted-globals"],
  ["WebSocket", SHELL, `export const f = () => new WebSocket("ws://localhost");`, "no-restricted-globals"],
  ["EventSource", SHELL, `export const f = () => new EventSource("/x");`, "no-restricted-globals"],
  ["importScripts", SHELL, `export const f = () => { importScripts("a.js"); };`, "no-restricted-globals"],
  ["navigator.sendBeacon", SHELL, `export const f = () => navigator.sendBeacon("/x", "");`, "no-restricted-properties"],
  ["self.fetch", SHELL, `export const f = () => self.fetch("/x");`, "no-restricted-properties"],
  ["globalThis.fetch", UI, `export const f = () => globalThis.fetch("/x");`, "no-restricted-properties"],
  ["computed window['fetch']", SHELL, `export const f = () => window["fetch"];`, "no-restricted-syntax"],
  ["fetch in UI", UI, `export const f = () => fetch("/x");`, "no-restricted-globals"],
  // eval family (NFR-7)
  ["eval", SHELL, `export const f = () => eval("1");`, "no-eval"],
  ["window.eval", SHELL, `export const f = () => window.eval("1");`, "no-eval"],
  ["new Function", SHELL, `export const f = () => new Function("return 1");`, "no-new-func"],
  [
    "string setTimeout",
    SHELL,
    `export const f = () => setTimeout("alert(1)", 10);`,
    "@typescript-eslint/no-implied-eval",
  ],
  ["string setInterval", SHELL, `export const f = () => setInterval("alert(1)", 10);`, "no-restricted-syntax"],
  ["template setTimeout", UI, "export const f = () => setTimeout(`x()`, 10);", "no-restricted-syntax"],
  [
    "string-typed timer var",
    SHELL,
    `const s: string = "x()";\nexport const f = () => setTimeout(s, 10);`,
    "@typescript-eslint/no-implied-eval",
  ],
  // MAIN world (API_CONTRACTS §4)
  [
    "world: MAIN",
    SHELL,
    `export const f = () => chrome.scripting.executeScript({ target: { tabId: 1 }, files: ["overlay.js"], world: "MAIN" });`,
    "no-restricted-syntax",
  ],
  [
    "quoted world key",
    SHELL,
    `export const opts = { target: { tabId: 1 }, files: ["overlay.js"], "world": "MAIN" };`,
    "no-restricted-syntax",
  ],
  // UI must not receive messages (API_CONTRACTS §1)
  ["ui runtime.onMessage", UI, `chrome.runtime.onMessage.addListener(() => false);`, "no-restricted-syntax"],
  [
    "ui destructured onMessage",
    UI,
    `const { onMessage } = chrome.runtime;\nexport const m = onMessage;`,
    "no-restricted-syntax",
  ],
  ["ui onMessageExternal", UI, `chrome.runtime.onMessageExternal.addListener(() => false);`, "no-restricted-syntax"],
];

const GOOD: [name: string, file: string, code: string][] = [
  [
    "pure core",
    CORE,
    `import { createFakeClock } from "./clock";\nexport const later = (ms: number) => { const c = createFakeClock(0); c.advance(ms); return c.now(); };`,
  ],
  [
    "shell uses chrome and function timers",
    SHELL,
    `export async function save(): Promise<void> {\n  await chrome.storage.local.set({ a: 1 });\n  setTimeout(() => undefined, 10);\n}\nexport const opts = { target: { tabId: 1 }, files: ["overlay.js"], world: "ISOLATED" };`,
  ],
  ["ui sends messages", UI, `export const send = () => chrome.runtime.sendMessage({ type: "ping" });`],
  ["offscreen may listen", OFFSCREEN, `chrome.runtime.onMessage.addListener(() => false);`],
];

describe("project lint rules (ADR-0007)", () => {
  it.each(BAD)("flags %s", async (_name, file, code, rule) => {
    const messages = await lint(code, file);
    expect(messages.map((m) => m.ruleId)).toContain(rule);
    expect(messages.every((m) => !m.fatal)).toBe(true);
  });

  it.each(GOOD)("accepts %s", async (_name, file, code) => {
    const messages = await lint(code, file);
    expect(messages).toEqual([]);
  });
});
