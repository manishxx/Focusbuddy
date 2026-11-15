# ADR-0007: Toolchain, build and engineering standards

- Status: Accepted (Day 05 Session A). Independent review in Session C. Builds on ADR-0001, ADR-0005, SD-7, D-003
- Context: Day 05 creates the first production code. It needs a typed build for an MV3 extension with three kinds of output: React pages, one ES-module service worker, and one classic injected script. It also needs CI that enforces the privacy rules mechanically, not just by review. There's no paid service budget (D-003). Packages should be few, well known and not freshly published.
- Decision:
  - **Runtime and package manager.** Node ≥ 24 (CI uses Node 24 LTS; local development uses 26). npm with a committed lockfile, `npm ci` in CI, and exact version pins (`save-exact`). A dependency is added only at a version **≥ 14 days old**, and is recorded in the commit message.
  - **Language.** TypeScript 6.0 `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. Not TypeScript 7: typescript-eslint 8.72 supports `<6.1`.
  - **Build.** Vite 8, driven by `scripts/build.mjs`, which runs three builds into `dist/`:
    1. pages (`sidepanel.html`, `options.html`, `intervention.html`, `offscreen.html`), React 19, no remote assets;
    2. `sw.js` as one ES module (`"background": {"type": "module"}`);
    3. `overlay.js` as a self-contained IIFE, because `executeScript({files})` needs a classic script.

    `src/manifest.json` is copied with `version` taken from `package.json`. No CRXJS or other extension plugin: fewer dependencies, and the output is easy to reason about.
  - **Lint.** ESLint 9 flat config + typescript-eslint (type-checked) + react-hooks + Prettier. Project rules that enforce ARCHITECTURE and SECURITY:
    - `src/core/**` must not import `chrome`, `shell/*` or `ui/*`, or use the `chrome` global (ADR-0001).
    - Everywhere in `src/**`, no network APIs: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, and no `importScripts` (NFR-5, ADR-0005). The AI mock and Day 11 topic packs are imported as modules (ARCH §13 V4).
    - No `eval`, `new Function`, or string `setTimeout`/`setInterval` (NFR-7).
    - Never `world: "MAIN"` in `executeScript` (API_CONTRACTS §4).
    - UI pages must not register `chrome.runtime.onMessage` (API_CONTRACTS §1).
  - **Tests.** Vitest 4 (unit and integration, Node environment) with v8 coverage and a **≥ 80 % line threshold on `src/core/**`** (NFR-10). The e2e harness is puppeteer-core + `enableExtensions` against locally installed Chrome (SD-7), in `tests/e2e/`. It runs locally from Day 05; CI e2e is decided on Day 14, because it needs Chrome on the runner.
  - **Copy.** The message bank and banned phrases move to `src/core/messages/` (one source of truth). `scripts/lint-messages.mjs` (moved from the Day 04 prototype) runs in CI (AC-31).
  - **CI.** GitHub Actions on push and pull request, one job: `npm ci` → `typecheck` → `lint` → `lint:messages` → `check:manifest` → `check:secrets` → `test:coverage` → `build`. GitHub Actions is part of the existing GitHub account; its included free minutes are enough. It adds no paid service (D-003). If Actions can't run, CI is reported as **not verified**, never as passing.
  - **Manifest guard.** `scripts/check-manifest.mjs` fails if any of these differ from SECURITY §3 and §6: the permission lists, the optional host permissions, the CSP string, `minimum_chrome_version`, or the absence of `web_accessible_resources` / `externally_connectable`.
  - **Commits.** Conventional Commits. Spikes and prototypes are excluded from typecheck, lint, tests and CI.
- Consequences:
  - (+) Privacy and architecture rules fail the build instead of relying on review.
  - (+) Small dependency surface. Reproducible installs.
  - (−) A custom build script to maintain.
  - (−) No CI e2e yet.
  - (−) Pinned old-ish versions need deliberate upgrades.
