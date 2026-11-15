# Day 05 — Session B: Scaffold, guards, CI, platform probe

**Agents/models:**
- Scaffold implementer: subagent, `model: opus` (exact version unknown). 134,053 tokens reported, 41 tool uses, about 12 min.
- Platform-facts probe (`tests/e2e/platform/`): Principal Architect, Claude Opus 5.5.

## Scaffold (implementer)
- **Build:** `scripts/build.mjs` runs three Vite builds → `dist/` (17 files). It fails the build on inline scripts or styles, remote URLs, preload helpers, overlay imports or SW imports. Two runs produce identical SHA-1s (implementer's check).
- **Source:**
  - `src/manifest.json` (exact SECURITY §3/§6 permissions and CSP; version injected at build).
  - `src/core/clock.ts`; `src/core/messages/index.ts` (`format()` with placeholder truncation).
  - `src/shell/sw.ts`; offscreen, overlay and three React page stubs.
- **Guards:**
  - `eslint.config.js` project rules, with `tests/unit/lint-rules.test.ts` (29 bad snippets fire, 4 good pass).
  - `scripts/check-manifest.mjs`, `scripts/check-secrets.mjs`.
- **Tests:** `tests/e2e/smoke.mjs` (SW starts; pages render; 0 console errors, 0 CSP violations, 0 external requests; plus a CSP-detector positive control).
- **CI:** `.github/workflows/ci.yml` (Node 24, `contents: read`, actions pinned by SHA).

## Platform probe (architect)
`tests/e2e/platform/probe-ext/` plus `run-platform-facts.mjs`: a test-only extension and a local HTTP server that records whether requests really left the browser. Results are in Session C.

## Tests (run by the architect after the hand-back, Node 26, Chrome 157.0.8103.51)
| Check | Result |
|---|---|
| `npm ci` | OK. `npm audit`: 7 moderate (dev-only minimatch ReDoS via typescript-eslint) |
| `npm run ci` | **exit 0**: typecheck, lint, prettier, message lint (172 strings; self-test 31/31 + 12/12), manifest PASS, secret scan PASS (124 files), **57 tests passed**, core coverage 100 % lines, build 17 files, dist manifest PASS |
| `npm run e2e:smoke` | `"ok": true` |
| `node tests/e2e/platform/run-platform-facts.mjs` | see DAY05_C |
