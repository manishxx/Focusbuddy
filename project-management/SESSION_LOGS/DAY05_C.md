# Day 05 — Session C: Verification, platform facts, independent review

**Agents/models:**
- Reviewer: subagent, `model: opus` (exact version unknown). It is a different agent from the implementer. Two rounds: the harness reported 150,397 and 202,748 tokens (whether those are cumulative is unknown).
- Implementer fix rounds: the same subagent as Session B. 230,337 and 248,041 tokens reported (cumulative or not: unknown).
- Platform probe, verification and approval: Principal Architect, Claude Opus 5.5.

## Review results
| Round | Verdict | Major | Minor |
|---|---|---|---|
| Review 1 (at 72caa14) | APPROVE WITH CHANGES | 4 (F1 access level not re-applied; F2 lint evasions; F3 no navigation rule; F4 overlay not network-tested) | 10 |
| Re-check (at aaac2fe) | APPROVE WITH CHANGES: 10 fixed, 3 partial, 1 accepted | 2 new (N1 `declare` shadowing; N2 chrome type references blocked) + R7 conditions | — |

After the re-check, the implementer fixed N1, N2, R7 (a) (ban `registerContentScripts`) and R7 (b) (`readyHardened` / `isHardened`), plus three extras: ban `storage.sync`, JSX remote-URL literals, placeholder-safe secret scan. The architect **verified these with a probe**: `declare const fetch` was flagged; `registerContentScripts` and `storage.sync` were flagged; typed chrome code passed. There was no third review.

## Carried forward (accepted, tracked)
- **F2 residue.** Lint can't close these: non-function chrome aliases; non-literal JSX URLs; URL properties set on created elements; notification `iconUrl`; runtime CSS `url()`; `new Audio`; `srcSet` candidates after the first. Backstops: the extension-page CSP (V3/V4 verified) and the AC-10 network test.
- **F4.** An AC-10 test that injects the overlay and watches the *tab's* network has to land with the overlay (Day 09). The content-script context isn't covered by the extension CSP.
- **F7 residue.** The secret scan still misses AWS secret keys, `Bearer` tokens, hex `api_key`, split or base64 tokens, UTF-16BE without a BOM, and binaries with an embedded NUL.
- **F13.** 7 moderate dev-only `npm audit` findings (one minimatch ReDoS via typescript-eslint). Upgrade when a fixed version is ≥ 14 days old. Dev licences include MPL-2.0 (lightningcss) and CC-BY-4.0 (caniuse-lite data); neither is bundled. Runtime deps (react, react-dom, scheduler) are MIT.
- **R7 (c).** One injection adapter that awaits `readyHardened` and refuses when it's false (Day 09).

## Platform facts (ARCHITECTURE §13; Chrome 157.0.8103.51, headless; evidence `tests/e2e/platform/results-day05.json`)
| # | Result |
|---|---|
| V1 | setAccessLevel works. It **resets on browser restart**. Applying it at top level on every SW evaluation protects once the SW has run → SECURITY R7 |
| V2 | SW → offscreen `sender.url` = `getURL("sw.js")`, no tab |
| V3 | The CSP blocks the SW's `fetch`; a `connect-src *` control reaches the server |
| V4 | Bundled-file fetch allowed from a page and from the SW |
| V5 | Not observable |
| V6 | `storage.session` cleared on reload (same-path reload; `runtime.reload()` not testable here) |
| V7 | Not tested → owner M20 |
| V8 / UX-5 | `showModal()` from a closed shadow root in the isolated world: top layer, page inert, can't be covered |
| UX-3 | Install warnings exactly "Read your browsing history", "Display notifications" |
| UX-6 | Not tested → owner M21 |
| Chrome 120 | **Skipped**: no owner approval for the Chrome for Testing download |

## Final checks (run by the architect after the last change)
| Check | Result |
|---|---|
| `npm run ci` (local, Node 26) | **exit 0**: typecheck (src, core, tests), lint, prettier, message lint, manifest (src + dist), secret scan (repo 137, dist 13), **267 tests passed**, core lines 100 % (per file), build 17 files |
| `npm run e2e:smoke` | `"ok": true`. 0 errors, 0 external requests. CSP, page-fetch, SW-fetch and observer controls all positive |
| `node tests/e2e/platform/run-platform-facts.mjs` | As in the table above |
| GitHub Actions | Run #1 on 72caa14 (branch push, before the trigger change): **success**. The final run on `main` is recorded in CURRENT_STATE after the push |

## Approval
ADR-0007 **Accepted** (D-019). F-030 DONE once CI on `main` is green.
