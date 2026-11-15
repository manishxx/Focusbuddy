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
            allowDefaultProject: [
              "vitest.config.ts",
              "src/*/__lint_probe__.ts",
              "src/*/__lint_probe__.tsx",
              "src/*/__lint_probe__.d.ts",
              "src/*/*/__lint_probe__.ts",
              "src/ui/*/__lint_probe__.tsx",
            ],
            defaultProject: "tsconfig.json",
            // Every probe path counts as a default-project file; there are more than 8.
            maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 64,
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
const CORE_TSX = "src/core/__lint_probe__.tsx";
const LIB = "src/lib/__lint_probe__.ts";
const SHELL_DTS = "src/shell/__lint_probe__.d.ts";
const CORE_DTS = "src/core/__lint_probe__.d.ts";
const CONTENT_DTS = "src/content/__lint_probe__.d.ts";

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
  ["core uses globalThis.chrome", CORE, `export const q = () => globalThis.chrome;`, "no-restricted-globals"],
  ["core uses fetch", CORE, `export const f = () => fetch("/x");`, "no-restricted-globals"],
  // network (NFR-5, ADR-0005)
  ["fetch", SHELL, `export const f = () => fetch("/x");`, "no-restricted-globals"],
  ["XMLHttpRequest", SHELL, `export const f = () => new XMLHttpRequest();`, "no-restricted-globals"],
  ["WebSocket", SHELL, `export const f = () => new WebSocket("ws://localhost");`, "no-restricted-globals"],
  ["EventSource", SHELL, `export const f = () => new EventSource("/x");`, "no-restricted-globals"],
  ["importScripts", SHELL, `export const f = () => { importScripts("a.js"); };`, "no-restricted-globals"],
  ["navigator.sendBeacon", SHELL, `export const f = () => navigator.sendBeacon("/x", "");`, "no-restricted-properties"],
  ["self.fetch", SHELL, `export const f = () => self.fetch("/x");`, "no-restricted-globals"],
  ["globalThis.fetch", UI, `export const f = () => globalThis.fetch("/x");`, "no-restricted-globals"],
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

  // ---- Day 05 review (F2): evasions that used to pass ----
  // network through global objects or indirection
  ["globalThis['fe'+'tch']", SHELL, `export const f = () => globalThis["fe" + "tch"];`, "no-restricted-globals"],
  [
    "globalThis['fe'+'tch'] (syntax)",
    SHELL,
    `export const f = () => globalThis["fe" + "tch"];`,
    "no-restricted-syntax",
  ],
  ["globalThis[`fetch`]", SHELL, "export const f = () => globalThis[`fetch`];", "no-restricted-globals"],
  [
    "globalThis[k]",
    SHELL,
    `const k = "fetch" as const;\nexport const f = () => globalThis[k];`,
    "no-restricted-globals",
  ],
  ["Reflect.get(self, 'fetch')", SHELL, `export const f = () => Reflect.get(self, "fetch");`, "no-restricted-globals"],
  [
    "new (window as any).XMLHttpRequest()",
    UI,
    `export const f = () => new (window as any).XMLHttpRequest();`,
    "no-restricted-globals",
  ],
  [
    "(window as any) is any",
    UI,
    `export const f = () => new (window as any).XMLHttpRequest();`,
    "@typescript-eslint/no-explicit-any",
  ],
  [
    "const {XMLHttpRequest: X} = self as any",
    SHELL,
    `const { XMLHttpRequest: X } = self as any;\nexport const x = X;`,
    "no-restricted-globals",
  ],
  [
    "dynamic import('https://...')",
    SHELL,
    `export const f = () => import("https://cdn.example/x.js");`,
    "no-restricted-syntax",
  ],
  [
    "static import 'https://...'",
    SHELL,
    `import x from "https://cdn.example/x.js";\nexport const y = x;`,
    "no-restricted-syntax",
  ],
  ["core dynamic import of shell", CORE, `export const f = () => import("../../shell/sw");`, "fb/core-imports"],
  ["core dynamic import (syntax ban)", CORE, `export const f = () => import("./clock");`, "no-restricted-syntax"],
  [
    "core bare package import",
    CORE,
    `import { useState } from "react";\nexport const s = useState;`,
    "fb/core-imports",
  ],
  ["core import escaping via src/lib", CORE, `import { c } from "../lib/c";\nexport const d = c;`, "fb/core-imports"],
  [
    "core import escaping deep",
    "src/core/messages/__lint_probe__.ts",
    `export { x } from "../../lib/c";`,
    "fb/core-imports",
  ],
  [
    "core import type from shell",
    CORE,
    `import type { HardeningApi } from "../shell/hardening";\nexport type A = HardeningApi;`,
    "fb/core-imports",
  ],
  // chrome from core
  [
    "core (globalThis as any)['chrome']",
    CORE,
    `export const c = () => (globalThis as any)["chrome"];`,
    "no-restricted-globals",
  ],
  [
    "core Reflect.get(globalThis, 'chr'+'ome')",
    CORE,
    `export const c = () => Reflect.get(globalThis, "chr" + "ome");`,
    "no-restricted-globals",
  ],
  ["core (window as any).chrome", CORE, `export const c = () => (window as any).chrome;`, "no-restricted-globals"],
  ["chrome shim export const c = chrome", LIB, `export const c = chrome;`, "fb/chrome-access"],
  // eval family
  ["(globalThis as any).eval", SHELL, `export const f = () => (globalThis as any).eval("1");`, "no-restricted-globals"],
  [
    "(() => 0).constructor('...')",
    SHELL,
    `export const f = () => (() => 0).constructor("return 1");`,
    "no-restricted-syntax",
  ],
  [
    "(() => 0)['constr'+'uctor']",
    SHELL,
    `export const f = () => (() => 0)["constr" + "uctor"];`,
    "no-restricted-syntax",
  ],
  ["Function global", SHELL, `export const f = () => Function("return 1");`, "no-restricted-globals"],
  // DOM injection and remote loads
  ["createElement('script')", UI, `export const f = () => document.createElement("script");`, "no-restricted-syntax"],
  ["createElement('iframe')", UI, `export const f = () => document.createElement("iframe");`, "no-restricted-syntax"],
  ["createElement('link')", UI, `export const f = () => document.createElement("link");`, "no-restricted-syntax"],
  ["createElement(variable)", UI, `export const f = (t: string) => document.createElement(t);`, "no-restricted-syntax"],
  [
    "new Image().src",
    UI,
    `export const f = () => { new Image().src = "https://x.example/p.gif"; };`,
    "no-restricted-globals",
  ],
  ["new Worker", SHELL, `export const f = () => new Worker("w.js");`, "no-restricted-globals"],
  ["new SharedWorker", UI, `export const f = () => new SharedWorker("w.js");`, "no-restricted-globals"],
  ["new RTCPeerConnection", UI, `export const f = () => new RTCPeerConnection();`, "no-restricted-globals"],
  ["new WebTransport", UI, `export const f = () => new WebTransport("https://x.example");`, "no-restricted-globals"],
  ["location.href =", UI, `export const f = () => { location.href = "https://x.example"; };`, "no-restricted-syntax"],
  ["location.assign", UI, `export const f = () => location.assign("https://x.example");`, "no-restricted-syntax"],
  [
    "document.location =",
    UI,
    `export const f = (u: string) => { document.location.href = u; };`,
    "no-restricted-syntax",
  ],
  [
    "a.href =",
    UI,
    `export const f = (a: HTMLAnchorElement) => { a.href = "https://x.example"; };`,
    "no-restricted-syntax",
  ],
  [
    "setAttribute('href')",
    UI,
    `export const f = (a: HTMLElement) => a.setAttribute("href", "https://x.example");`,
    "no-restricted-syntax",
  ],
  ["window.open", UI, `export const f = () => window.open("https://x.example");`, "no-restricted-globals"],
  ["open()", UI, `export const f = () => open("https://x.example");`, "no-restricted-globals"],
  ["innerHTML", UI, `export const f = (el: HTMLElement) => { el.innerHTML = "<b>x</b>"; };`, "no-restricted-syntax"],
  ["outerHTML", UI, `export const f = (el: HTMLElement) => el.outerHTML;`, "no-restricted-syntax"],
  [
    "insertAdjacentHTML",
    UI,
    `export const f = (el: HTMLElement) => el.insertAdjacentHTML("beforeend", "<i>");`,
    "no-restricted-syntax",
  ],
  ["document.write", UI, `export const f = () => document.write("<p>");`, "no-restricted-properties"],
  [
    "dangerouslySetInnerHTML",
    UI,
    `export const C = () => <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />;`,
    "no-restricted-syntax",
  ],
  ["JSX remote href", UI, `export const C = () => <a href="https://x.example">x</a>;`, "no-restricted-syntax"],
  [
    "setUninstallURL",
    SHELL,
    `export const f = () => chrome.runtime.setUninstallURL("https://x.example");`,
    "no-restricted-syntax",
  ],
  // UI message receivers through aliases or computed access
  [
    "ui const rt = chrome.runtime; rt.onMessage",
    UI,
    `const rt = chrome.runtime;\nrt.onMessage.addListener(() => false);`,
    "no-restricted-syntax",
  ],
  [
    "ui alias is also a chrome-access error",
    UI,
    `const rt = chrome.runtime;\nrt.onMessage.addListener(() => false);`,
    "fb/chrome-access",
  ],
  [
    "ui chrome['runtime']['onMessage']",
    UI,
    `chrome["runtime"]["onMessage"].addListener(() => false);`,
    "no-restricted-syntax",
  ],
  [
    "ui chrome['runtime'] (chrome-access)",
    UI,
    `chrome["runtime"]["onMessage"].addListener(() => false);`,
    "fb/chrome-access",
  ],
  ["ui const { runtime } = chrome", UI, `const { runtime } = chrome;\nexport const r = runtime;`, "fb/chrome-access"],
  ["ui onConnect", UI, `chrome.runtime.onConnect.addListener(() => undefined);`, "no-restricted-syntax"],
  // chrome indirection anywhere in src
  [
    "alias a chrome function",
    SHELL,
    `const c = chrome.tabs.create;\nexport const f = () => c({});`,
    "fb/chrome-access",
  ],
  [
    "chrome.tabs.create.call",
    SHELL,
    `export const f = () => chrome.tabs.create.call(null, { url: "https://x.example" });`,
    "fb/chrome-access",
  ],
  [
    "pass a chrome namespace",
    SHELL,
    `const use = (t: typeof chrome.tabs) => t;\nexport const f = () => use(chrome.tabs);`,
    "fb/chrome-access",
  ],
  // ---- F3: navigation only to extension pages (SECURITY §6) ----
  [
    "tabs.create remote url",
    SHELL,
    `export const f = () => chrome.tabs.create({ url: "https://x.example" });`,
    "fb/chrome-call-args",
  ],
  [
    "tabs.create url variable",
    SHELL,
    `export const f = (url: string) => chrome.tabs.create({ url });`,
    "fb/chrome-call-args",
  ],
  [
    "tabs.create props variable",
    SHELL,
    `export const f = (p: chrome.tabs.CreateProperties) => chrome.tabs.create(p);`,
    "fb/chrome-call-args",
  ],
  [
    "tabs.create spread",
    SHELL,
    `const p = { url: "https://x.example" };\nexport const f = () => chrome.tabs.create({ ...p });`,
    "fb/chrome-call-args",
  ],
  [
    "tabs.update remote url",
    SHELL,
    `export const f = () => chrome.tabs.update(1, { url: "https://x.example" });`,
    "fb/chrome-call-args",
  ],
  [
    "tabs.update url variable, no tabId",
    SHELL,
    `export const f = (url: string) => chrome.tabs.update({ url });`,
    "fb/chrome-call-args",
  ],
  [
    "tabs.update other keys",
    SHELL,
    `export const f = () => chrome.tabs.update(1, { openerTabId: 2 });`,
    "fb/chrome-call-args",
  ],
  [
    "windows.create remote url",
    SHELL,
    `export const f = () => chrome.windows.create({ url: "https://x.example" });`,
    "fb/chrome-call-args",
  ],
  [
    "windows.create remote url list",
    SHELL,
    `export const f = () => chrome.windows.create({ url: [chrome.runtime.getURL("a.html"), "https://x.example"] });`,
    "fb/chrome-call-args",
  ],
  [
    "executeScript world variable",
    SHELL,
    `const w = "MA" + "IN";\nexport const f = () => chrome.scripting.executeScript({ target: { tabId: 1 }, files: ["overlay.js"], world: w as "MAIN" });`,
    "fb/chrome-call-args",
  ],
  // ---- guard integrity ----
  [
    "eslint-disable is ignored in src",
    SHELL,
    `// eslint-disable-next-line no-restricted-globals\nexport const f = () => fetch("/x");`,
    "no-restricted-globals",
  ],
  ["@ts-ignore banned", SHELL, `// @ts-ignore\nexport const f: number = "x";`, "@typescript-eslint/ban-ts-comment"],
  ["as any banned", SHELL, `export const f = (x: unknown) => x as any;`, "@typescript-eslint/no-explicit-any"],
  ["core .tsx banned", CORE_TSX, `export const a = 1;`, "no-restricted-syntax"],
  // ---- Day 05 re-review ----
  // N1: ambient declarations shadowing banned globals
  [
    "declare const fetch",
    SHELL,
    `declare const fetch: (u: string) => Promise<unknown>;\nexport const f = () => fetch("https://evil.example");`,
    "no-restricted-syntax",
  ],
  [
    "declare const XMLHttpRequest",
    UI,
    `declare const XMLHttpRequest: new () => object;\nexport const f = () => new XMLHttpRequest();`,
    "no-restricted-syntax",
  ],
  [
    "declare const chrome in core",
    CORE,
    `declare const chrome: { tabs: { query(q: object): void } };\nexport const f = () => chrome.tabs.query({});`,
    "no-restricted-syntax",
  ],
  [
    "declare function",
    SHELL,
    `declare function fetch(u: string): Promise<unknown>;\nexport const f = () => fetch("https://evil.example");`,
    "no-restricted-syntax",
  ],
  [
    "declare global",
    SHELL,
    `declare global {\n  const sneaky: (u: string) => void;\n}\nexport {};`,
    "no-restricted-syntax",
  ],
  [
    "declare module",
    SHELL,
    `declare module "evil" {\n  export const x: number;\n}\nexport {};`,
    "no-restricted-syntax",
  ],
  ["declare class", SHELL, `declare class WebSocket2 {}\nexport const w = WebSocket2;`, "no-restricted-syntax"],
  ["namespace", SHELL, `namespace N {\n  export const x = 1;\n}\nexport const y = N.x;`, "no-restricted-syntax"],
  [".d.ts in core", CORE_DTS, `export interface A { a: number }`, "no-restricted-syntax"],
  [".d.ts in content", CONTENT_DTS, `export interface A { a: number }`, "no-restricted-syntax"],
  // R7 (a): registered content scripts
  [
    "registerContentScripts",
    SHELL,
    `export const f = () => chrome.scripting.registerContentScripts([{ id: "x", js: ["overlay.js"], matches: ["https://*/*"] }]);`,
    "no-restricted-syntax",
  ],
  [
    "updateContentScripts",
    SHELL,
    `export const f = () => chrome.scripting.updateContentScripts([{ id: "x", js: ["overlay.js"] }]);`,
    "no-restricted-syntax",
  ],
  // extras
  ["storage.sync", SHELL, `export const f = () => chrome.storage.sync.set({ a: 1 });`, "no-restricted-syntax"],
  [
    "JSX src={'https://...'}",
    UI,
    `export const C = () => <img src={"https://x.example/a.png"} alt="" />;`,
    "no-restricted-syntax",
  ],
  [
    "JSX src={`https://...`}",
    UI,
    'export const C = () => <img src={`https://x.example/${1}.png`} alt="" />;',
    "no-restricted-syntax",
  ],
  ["JSX protocol-relative href", UI, `export const C = () => <a href="//x.example">x</a>;`, "no-restricted-syntax"],
  [
    "JSX srcSet remote",
    UI,
    `export const C = () => <img srcSet="https://x.example/a.png 2x" alt="" />;`,
    "no-restricted-syntax",
  ],
  [
    "JSX ping remote",
    UI,
    `export const C = () => <a href="#a" ping="https://x.example/p">x</a>;`,
    "no-restricted-syntax",
  ],
  [
    "JSX poster remote",
    UI,
    `export const C = () => <video poster={"https://x.example/p.png"} />;`,
    "no-restricted-syntax",
  ],
  [
    "JSX formAction remote",
    UI,
    `export const C = () => <button formAction="https://x.example/f">x</button>;`,
    "no-restricted-syntax",
  ],
  [
    "JSX action remote",
    UI,
    `export const C = () => <form action={\`https://x.example/f\`} />;`,
    "no-restricted-syntax",
  ],
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
  [
    "core relative import inside core",
    "src/core/messages/__lint_probe__.ts",
    `import { createFakeClock } from "../clock";\nexport const c = createFakeClock;`,
  ],
  [
    "shell opens extension pages",
    SHELL,
    [
      `export async function go(tabId: number): Promise<void> {`,
      `  await chrome.tabs.create({ url: chrome.runtime.getURL("intervention.html"), active: true });`,
      `  await chrome.tabs.update(tabId, { active: true });`,
      `  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL("intervention.html") });`,
      `  await chrome.windows.create({ url: [chrome.runtime.getURL("options.html")], focused: true });`,
      `  await chrome.windows.create();`,
      `  await chrome.scripting.executeScript({ target: { tabId }, files: ["overlay.js"], world: "ISOLATED" });`,
      `  await chrome.scripting.executeScript({ target: { tabId }, files: ["overlay.js"] });`,
      `}`,
      `export const hasChrome = typeof chrome !== "undefined";`,
      `export const id = chrome.runtime.id;`,
      `export const at = (xs: number[], i: number) => xs[i + 1];`,
    ].join("\n"),
  ],
  // N2: chrome in type positions is not runtime access
  ["type chrome.tabs.Tab", SHELL, `export const title = (t: chrome.tabs.Tab): string => t.title ?? "";`],
  [
    "type chrome.runtime.MessageSender",
    OFFSCREEN,
    `export const fromSw = (s: chrome.runtime.MessageSender): boolean => s.tab === undefined;`,
  ],
  [
    "type chrome.storage.StorageChange",
    SHELL,
    `export const changed = (c: chrome.storage.StorageChange): boolean => c.newValue !== c.oldValue;`,
  ],
  ["type alias = chrome.tabs.Tab", SHELL, `export type Tab = chrome.tabs.Tab;`],
  ["ReturnType<typeof chrome.tabs.get>", SHELL, `export type GetResult = ReturnType<typeof chrome.tabs.get>;`],
  [
    "generic with chrome type",
    SHELL,
    `export const ids = (tabs: Array<chrome.tabs.Tab>): number[] => tabs.flatMap((t) => (t.id === undefined ? [] : [t.id]));`,
  ],
  [
    "ambient declarations in a shell .d.ts",
    SHELL_DTS,
    `declare const BUILD_ID: string;\ninterface Window { fb?: never }`,
  ],
  ["JSX extension-relative src", UI, `export const C = () => <img src="icons/icon16.png" alt="" />;`],
  [
    "ui builds DOM safely",
    UI,
    [
      `export function add(parent: HTMLElement): void {`,
      `  const p = document.createElement("p");`,
      `  p.textContent = "hi";`,
      `  p.setAttribute("aria-live", "polite");`,
      `  parent.append(p);`,
      `}`,
      `export const C = () => <a href="#main">skip</a>;`,
    ].join("\n"),
  ],
];

/**
 * Known evasions lint can NOT close (backstopped by the CSP in SECURITY §6, the
 * built-bundle checks in scripts/build.mjs and the AC-10 network test):
 * - third-party code in the bundle (React) is not linted;
 * - aliasing chrome objects that are not functions, e.g. const s = chrome.storage.local;
 * - non-literal URL values in JSX (href={x}) and Object.assign(el, { href });
 * - computed access on ordinary objects with a variable key whose value is obtained
 *   without naming a global (TypeScript strict and no-unsafe-* reject most of these);
 * - remote URLs passed to APIs not listed in fb/chrome-call-args (e.g. a notification
 *   iconUrl), and CSS url() in stylesheets (build.mjs checks the built CSS).
 */
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
