# Day 05 — Repo, environment, scaffold, CI

**Status:** Completed
**Branch:** `chore/day-05-scaffold` (merged to `main` after Session C)

| Session | Outcome | Log |
|---|---|---|
| A | ADR-0007 toolchain and standards; dependency age rule; message bank moved into `src/` | [DAY05_A](../SESSION_LOGS/DAY05_A.md) |
| B | Scaffold, three-part build, guard rules, manifest and secret guards, smoke test, CI; platform probe | [DAY05_B](../SESSION_LOGS/DAY05_B.md) |
| C | Platform facts V1–V8; review (14 findings) + re-check (2 new + R7) → fixed; CI green | [DAY05_C](../SESSION_LOGS/DAY05_C.md) |

## Handoff
```
DEVELOPMENT DAY: 05
SESSION: C (complete)
COMPLETED: ADR-0007, scaffold (src/**, scripts/*, tests/**), CI workflow, platform facts in ARCHITECTURE §13, SECURITY R7, D-019, F-030
TEST RESULTS: npm run ci exit 0 (267 tests, core 100 % lines); e2e smoke ok; platform probe (results-day05.json); GitHub Actions see CURRENT_STATE
OPEN ISSUES: Chrome 120 untested (owner approval); V7/UX-6 owner checks M20/M21; overlay AC-10 test + injection adapter (Day 09); lint residue backstopped by CSP/AC-10; npm audit moderate dev-only
FILES CHANGED: package*.json, .npmrc, .nvmrc, tsconfig*, eslint.config.js, .prettier*, vitest.config.ts, scripts/*, src/**, tests/**, .github/workflows/ci.yml, README.md, docs/ARCHITECTURE.md, docs/SECURITY.md, docs/UX_GUIDELINES.md, docs/DECISIONS/ADR-0007, project-management/*
LAST COMMIT: see CURRENT_STATE.md
GITHUB STATUS: see CURRENT_STATE.md
NEXT TASK: Day 06 Session A — storage: repositories + validation over the approved DATA_MODEL v1.1
RESUME COMMAND: continue
```
