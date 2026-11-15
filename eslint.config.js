// ESLint flat config (ADR-0007). Project rules enforce ARCHITECTURE §3 / ADR-0001
// (pure core), NFR-5 / ADR-0005 (no network), NFR-7 (no eval), SECURITY §6 (navigation
// only to extension pages) and API_CONTRACTS §1, §4. tests/unit/lint-rules.test.ts
// proves that each rule fires, including the known evasions from the Day 05 review.
// Lint can't see through every indirection: the CSP and the AC-10 network test are
// the backstop (see the residual list in tests/unit/lint-rules.test.ts).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import fb from "./scripts/eslint-plugin-fb.mjs";

// ---- Rule building blocks (merged per scope, because a later config object
// replaces, not extends, an earlier setting of the same rule). ----

const restrictedGlobal = (message) => (name) => ({ name, message });
const SRC_GLOBALS = [
  ...["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "WebTransport"].map(
    restrictedGlobal("No network APIs in Focus Buddy (NFR-5, ADR-0005). Bundle data as modules instead."),
  ),
  ...["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "Image", "Worker", "SharedWorker"].map(
    restrictedGlobal("Not allowed in src (NFR-5): this constructor can open a network channel or load remote code."),
  ),
  ...["globalThis", "self", "window", "global", "top", "parent", "opener", "frames"].map(
    restrictedGlobal("Don't use global objects in src: use the global directly so lint can see it (NFR-5, NFR-7)."),
  ),
  ...["Function", "Reflect"].map(restrictedGlobal("No Function constructor or Reflect indirection in src (NFR-7).")),
  restrictedGlobal("Navigation goes through a vetted helper (SECURITY §6), not window.open.")("open"),
];
const CHROME_GLOBAL = {
  name: "chrome",
  message: "src/core is pure: no chrome.* (ADR-0001). Pass data in from the shell.",
};

const SRC_PROPERTIES = [
  { object: "navigator", property: "sendBeacon", message: "No network APIs (NFR-5): navigator.sendBeacon." },
  { object: "document", property: "write", message: "No document.write (NFR-7)." },
  { object: "document", property: "writeln", message: "No document.writeln (NFR-7)." },
];

const GLOBALISH = "/^(globalThis|self|window|global|chrome|navigator|document|location|top|parent|frames|opener)$/";
const REMOTE = "/^([a-zA-Z][a-zA-Z0-9+.-]*:|\\/\\/)/";
const RISKY_ELEMENTS = "/^(script|iframe|frame|frameset|link|object|embed|base|meta|portal|fencedframe)$/i";

const SRC_SYNTAX = [
  // MAIN world (API_CONTRACTS §4); fb/chrome-call-args also checks executeScript.
  {
    selector: "Property[key.name='world'][value.value='MAIN'], Property[key.value='world'][value.value='MAIN']",
    message: 'Never inject into world: "MAIN" (API_CONTRACTS §4). Use the isolated world.',
  },
  // Network and remote code (NFR-5, ADR-0005).
  { selector: "MemberExpression[property.name='sendBeacon']", message: "No network APIs (NFR-5): sendBeacon." },
  {
    selector: `MemberExpression[computed=true][object.name=${GLOBALISH}]`,
    message: "No computed access on global objects (NFR-5, NFR-7): lint can't see what it reaches.",
  },
  {
    selector: `MemberExpression[computed=true][object.type=/^TS(As|Satisfies|NonNull)Expression$/][object.expression.name=${GLOBALISH}]`,
    message: "No computed access on global objects, even through a type assertion.",
  },
  {
    selector:
      "MemberExpression[computed=true][property.value=/^(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon|eval|Function|constructor|chrome)$/]",
    message: "No computed access to network, eval or chrome APIs (NFR-5, NFR-7).",
  },
  {
    selector:
      "MemberExpression[computed=true][property.type='BinaryExpression'][property.operator='+'][property.left.type='Literal'], MemberExpression[computed=true][property.type='BinaryExpression'][property.operator='+'][property.right.type='Literal'][property.right.raw=/^[\"']/], MemberExpression[computed=true][property.type='TemplateLiteral']",
    message: "No computed property names built from strings (NFR-5, NFR-7): write the property literally.",
  },
  { selector: "ImportExpression", message: "No dynamic import() in src (NFR-5): import statically from the bundle." },
  {
    selector: `ImportDeclaration[source.value=${REMOTE}], ExportNamedDeclaration[source.value=${REMOTE}], ExportAllDeclaration[source.value=${REMOTE}]`,
    message: "No remote or scheme imports (NFR-5).",
  },
  // eval family (NFR-7).
  {
    selector: "MemberExpression[property.name='constructor']",
    message: "No .constructor access in src (NFR-7): (() => 0).constructor is the Function constructor.",
  },
  {
    selector:
      "CallExpression[callee.name=/^(setTimeout|setInterval)$/][arguments.0.type=/^(Literal|TemplateLiteral)$/]",
    message: "No string timers (NFR-7). Pass a function.",
  },
  // DOM injection (NFR-7, CSP defence in depth).
  {
    selector: `CallExpression[callee.property.name='createElement'][arguments.0.type!='Literal'], CallExpression[callee.property.name='createElement'][arguments.0.value=${RISKY_ELEMENTS}]`,
    message: "createElement needs a literal, non-script tag name (no script/iframe/link/object/embed/base/meta).",
  },
  {
    selector: `CallExpression[callee.property.name='createElementNS'][arguments.1.type!='Literal'], CallExpression[callee.property.name='createElementNS'][arguments.1.value=${RISKY_ELEMENTS}]`,
    message: "createElementNS needs a literal, non-script tag name.",
  },
  {
    selector:
      "MemberExpression[property.name=/^(innerHTML|outerHTML|srcdoc)$/], Property[key.name=/^(innerHTML|outerHTML|srcdoc)$/], JSXAttribute[name.name=/^(dangerouslySetInnerHTML|srcDoc)$/]",
    message: "No HTML string sinks (innerHTML, outerHTML, srcdoc, dangerouslySetInnerHTML). Build DOM nodes or JSX.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(insertAdjacentHTML|createContextualFragment|setHTMLUnsafe|parseHTMLUnsafe)$/], CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
    message: "No HTML string sinks (insertAdjacentHTML, document.write, ...).",
  },
  // Navigation (SECURITY §6): only via a future vetted helper.
  {
    selector:
      "AssignmentExpression[left.name='location'], AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(location|href)$/], AssignmentExpression[left.object.name='location'], AssignmentExpression[left.object.property.name='location']",
    message: "No location/href assignment (SECURITY §6): navigation goes through a vetted helper.",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(assign|replace)$/][callee.object.name='location'], CallExpression[callee.property.name=/^(assign|replace)$/][callee.object.property.name='location'], CallExpression[callee.property.name='open'][callee.object.property.name='defaultView']",
    message: "No location.assign/replace or window.open (SECURITY §6).",
  },
  {
    selector:
      "CallExpression[callee.property.name=/^setAttribute(NS)?$/][arguments.0.type!='Literal'], CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(href|src|srcdoc|action|formaction|poster|data|xlink:href|on.*)$/i]",
    message: "setAttribute needs a literal, non-URL, non-handler attribute name (SECURITY §6, NFR-7).",
  },
  {
    selector: "MemberExpression[property.name='setUninstallURL']",
    message: "No uninstall URL (NFR-5): it would open a remote page.",
  },
  {
    selector: `JSXAttribute[name.name=/^(href|src|action|formAction|poster|data)$/][value.type='Literal'][value.value=${REMOTE}]`,
    message: "No remote or scheme URLs in JSX attributes (SECURITY §6, NFR-5).",
  },
];
const UI_SYNTAX = [
  {
    selector:
      "Identifier[name=/^on(Message|Connect)(External)?$/], Literal[value=/^on(Message|Connect)(External)?$/], TemplateElement[value.raw=/on(Message|Connect)/]",
    message: "UI pages must not receive runtime messages or ports (API_CONTRACTS §1). Use the command client.",
  },
];
const CORE_TSX = [{ selector: "Program", message: "src/core is plain TypeScript: no .tsx files (ADR-0001)." }];
const CORE_IMPORTS = {
  paths: [{ name: "chrome", message: "src/core is pure: no chrome imports (ADR-0001)." }],
  patterns: [
    {
      group: ["**/shell", "**/shell/**", "**/ui", "**/ui/**", "@types/chrome"],
      message: "src/core must not import shell/* or ui/* (ADR-0001).",
    },
  ],
};

// Type-aware guards: any/unsafe values would let code reach APIs lint can't see.
const TYPE_GUARDS = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unsafe-function-type": "error",
  "@typescript-eslint/no-unsafe-declaration-merging": "error",
  "@typescript-eslint/no-unsafe-type-assertion": "error",
  "@typescript-eslint/no-implied-eval": "error",
  "@typescript-eslint/ban-ts-comment": [
    "error",
    { "ts-ignore": true, "ts-nocheck": true, "ts-expect-error": true, "ts-check": false },
  ],
};

const tsFiles = ["**/*.ts", "**/*.tsx"];
const srcFiles = ["src/**/*.{ts,tsx,js,mjs}"];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "spikes/**",
      "prototypes/**",
      "docs/**",
      "project-management/**",
      "scripts/lint-messages.mjs",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { ...globals.node }, sourceType: "module" },
  },
  {
    files: tsFiles,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["vitest.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // e2e scripts run in Node but pass functions to page.evaluate() and load probe
    // extensions, so browser, worker and extension globals are legitimate there.
    files: ["tests/e2e/**/*.{js,mjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.serviceworker, ...globals.webextensions },
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
  },
  // ---- Everywhere in src/: no network, no eval, no string timers, no MAIN world,
  // no HTML sinks, no free navigation, chrome.* only as direct calls. ----
  {
    files: srcFiles,
    // eslint-disable comments would switch these guards off: not allowed in src.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    plugins: { fb },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "no-restricted-globals": ["error", ...SRC_GLOBALS],
      "no-restricted-properties": ["error", ...SRC_PROPERTIES],
      "no-restricted-syntax": ["error", ...SRC_SYNTAX],
      "no-eval": ["error", { allowIndirect: false }],
      "no-new-func": "error",
      "no-implied-eval": "off",
      "fb/chrome-access": "error",
      "fb/chrome-call-args": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: TYPE_GUARDS,
  },
  // ---- src/core: additionally pure (no chrome, shell or ui; relative imports only). ----
  {
    files: ["src/core/**/*.{ts,tsx,js,mjs}"],
    rules: {
      "no-restricted-imports": ["error", CORE_IMPORTS],
      "@typescript-eslint/no-restricted-imports": "off",
      "fb/core-imports": "error",
      "no-restricted-globals": ["error", ...SRC_GLOBALS, CHROME_GLOBAL],
    },
  },
  {
    files: ["src/core/**/*.tsx"],
    rules: { "no-restricted-syntax": ["error", ...SRC_SYNTAX, ...CORE_TSX] },
  },
  // ---- src/ui: additionally no runtime.onMessage / onConnect. ----
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...SRC_SYNTAX, ...UI_SYNTAX],
    },
  },
);
