// ESLint flat config (ADR-0007). Project rules enforce ARCHITECTURE §3 / ADR-0001
// (pure core), NFR-5 / ADR-0005 (no network), NFR-7 (no eval) and API_CONTRACTS §1, §4.
// tests/unit/lint-rules.test.ts proves that each rule fires.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// ---- Rule building blocks (merged per scope, because a later config object
// replaces, not extends, an earlier setting of the same rule). ----

const NETWORK_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"].map((name) => ({
  name,
  message: "No network APIs in Focus Buddy (NFR-5, ADR-0005). Bundle data as modules instead.",
}));
const CHROME_GLOBAL = {
  name: "chrome",
  message: "src/core is pure: no chrome.* (ADR-0001). Pass data in from the shell.",
};

const GLOBAL_OBJECTS = ["window", "self", "globalThis", "global"];
const NETWORK_PROPERTIES = [
  { object: "navigator", property: "sendBeacon", message: "No network APIs (NFR-5): navigator.sendBeacon." },
  ...GLOBAL_OBJECTS.flatMap((object) =>
    ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"].map((property) => ({
      object,
      property,
      message: `No network APIs (NFR-5): ${object}.${property}.`,
    })),
  ),
];
const CHROME_PROPERTIES = GLOBAL_OBJECTS.map((object) => ({
  object,
  property: "chrome",
  message: "src/core is pure: no chrome.* (ADR-0001).",
}));

const SRC_SYNTAX = [
  {
    selector: "Property[key.name='world'][value.value='MAIN'], Property[key.value='world'][value.value='MAIN']",
    message: 'Never inject into world: "MAIN" (API_CONTRACTS §4). Use the isolated world.',
  },
  {
    selector: "MemberExpression[property.name='sendBeacon']",
    message: "No network APIs (NFR-5): sendBeacon.",
  },
  {
    selector:
      "MemberExpression[computed=true][property.value=/^(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)$/]",
    message: "No network APIs (NFR-5), including computed access.",
  },
  {
    selector:
      "CallExpression[callee.name=/^(setTimeout|setInterval)$/][arguments.0.type=/^(Literal|TemplateLiteral)$/]",
    message: "No string timers (NFR-7). Pass a function.",
  },
];
const UI_SYNTAX = [
  {
    selector: "MemberExpression[object.property.name='runtime'][property.name=/^onMessage(External)?$/]",
    message: "UI pages must not register runtime.onMessage (API_CONTRACTS §1). Use the command client.",
  },
  {
    selector:
      "VariableDeclarator[init.property.name='runtime'] > ObjectPattern > Property[key.name=/^onMessage(External)?$/]",
    message: "UI pages must not register runtime.onMessage (API_CONTRACTS §1).",
  },
];
const CORE_IMPORTS = {
  paths: [{ name: "chrome", message: "src/core is pure: no chrome imports (ADR-0001)." }],
  patterns: [
    {
      group: ["**/shell", "**/shell/**", "**/ui", "**/ui/**", "@types/chrome"],
      message: "src/core must not import shell/* or ui/* (ADR-0001).",
    },
  ],
};

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts"];

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
  // ---- Everywhere in src/: no network, no eval, no string timers, no MAIN world. ----
  {
    files: ["src/**/*.{ts,tsx,js,mjs}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "no-restricted-globals": ["error", ...NETWORK_GLOBALS],
      "no-restricted-properties": ["error", ...NETWORK_PROPERTIES],
      "no-restricted-syntax": ["error", ...SRC_SYNTAX],
      "no-eval": ["error", { allowIndirect: false }],
      "no-new-func": "error",
      "no-implied-eval": "off",
      "@typescript-eslint/no-implied-eval": "error",
    },
  },
  // ---- src/core: additionally pure (no chrome, shell or ui). ----
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", CORE_IMPORTS],
      "@typescript-eslint/no-restricted-imports": "off",
      "no-restricted-globals": ["error", ...NETWORK_GLOBALS, CHROME_GLOBAL],
      "no-restricted-properties": ["error", ...NETWORK_PROPERTIES, ...CHROME_PROPERTIES],
    },
  },
  // ---- src/ui: additionally no runtime.onMessage. ----
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...SRC_SYNTAX, ...UI_SYNTAX],
    },
  },
);
