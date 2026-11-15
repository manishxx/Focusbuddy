# Day 02 — Session B: Feasibility spikes

**Goal:** Check the risky platform behaviours in real Chrome 157.
**Agents/models:** Orchestrator / Architect, Claude Opus 5.5. No implementation subagent; spikes are small and throwaway.

## Files created
- `spikes/day02-feasibility/extension/`: manifest, `sw.js`, side panel, offscreen audio, overlay, generated icon
- `spikes/day02-feasibility/harness/`: `run.mjs`, `t4-restart.mjs`, `package.json` (`puppeteer-core` 25.17.0, exact), results JSON
- `spikes/day02-feasibility/MANUAL_CHECKLIST.md`
- `docs/FEASIBILITY.md` (draft for Session C)

## Tests executed (automated, headless Chrome 157, temporary profile)
| Run | Result |
|---|---|
| `run.mjs` #1 | Tabs, idle, alarms registration, audio, notifications, overlay-denied and `sidePanel.open` checks produced results. The SW-restart step **failed** (puppeteer re-attach timeout) and the process hung. It was stopped manually. |
| `run.mjs` #2 | Restart step re-done with a page observer. `Target.closeTarget` **didn't** stop the worker, so that result was discarded. Overlay-with-permission path: **pass** (injected, Escape dismissed). |
| `t4-restart.mjs` | **Pass.** Alarms on time; worker stopped via `ServiceWorker.stopAllWorkers`; the alarm restarted it 15 s later; storage intact. |

## Bugs found (in harness, not product)
- The harness hung when the browser wasn't closed after an error. Fixed: browsers are closed in `finally`.
- Wrong SW-termination method. Replaced.

## Remaining
Owner manual checklist (M1–M14). Independent review.
