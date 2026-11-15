# Focus Buddy

A browser companion that helps people with ADHD-related trouble with attention and
executive function to start tasks, notice when they drift, and get back to them.
It is a Chrome extension (Manifest V3). It works offline, keeps data on your device,
and uses AI only if you turn it on.

> **Status:** Day 5 of a 30-day V1 programme: design approved and the code scaffold is in place.
> No features work yet, so there's nothing useful to install. See [project-management/CURRENT_STATE.md](project-management/CURRENT_STATE.md).

Focus Buddy is not a medical device and does not diagnose or treat ADHD.

## Documents
- [Product requirements](docs/PRD.md)
- [Master plan](project-management/MASTER_PLAN.md) · [30-day roadmap](project-management/30_DAY_ROADMAP.md)
- [Feature registry](project-management/FEATURE_REGISTRY.md) · [Task board](project-management/TASK_BOARD.md)
- [Agent working rules](AGENTS.md)

## Resuming development
Type `continue` in the Claude Code session. The agent rebuilds its state from
`project-management/CURRENT_STATE.md`, not from chat history.

## Development

Requirements: Node 24 or later (`.nvmrc` says 24; CI uses 24) and npm. Google Chrome
is needed only for the e2e smoke test.

```sh
npm ci              # install exact, locked versions
npm run build       # build the extension into dist/
npm run ci          # everything CI runs: typecheck, lint, format check, message lint,
                    # manifest guard, secret scan, unit tests with coverage, build,
                    # and the manifest guard again on dist/
npm run e2e:smoke   # load dist/ into local Chrome (headless) and check the pages
```

To try the build by hand, open `chrome://extensions`, turn on Developer mode, choose
**Load unpacked** and pick the `dist/` folder.

| Script | What it does |
|---|---|
| `typecheck` | `tsc --noEmit` for `src/` and for the unit tests |
| `lint` | ESLint, including the project rules from ADR-0007 (pure core, no network APIs, no eval, no `world: "MAIN"`, no `runtime.onMessage` in UI pages) |
| `format:check` | Prettier |
| `lint:messages` | Banned-phrase and length lint for the message bank (`src/core/messages/`) |
| `check:manifest` | Fails if the manifest's permissions, CSP or other guarded keys differ from SECURITY.md |
| `check:secrets` | Scans files git knows about (or `-- --dir dist`) for private keys, tokens, password literals and secret-looking files |
| `test` / `test:coverage` | Vitest; coverage needs at least 80 % of lines in `src/core/` |
| `e2e:smoke` | Puppeteer smoke test against local Chrome. Set `CHROME_PATH` to use another binary |

Layout: `src/core` is pure TypeScript with no `chrome.*`; `src/shell` is the service
worker; `src/ui` holds the React pages; `src/offscreen` and `src/content` hold the audio
document and the injected overlay. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §3
and [ADR-0007](docs/DECISIONS/ADR-0007-toolchain-and-build.md).
`spikes/` and `prototypes/` are excluded from all tooling.
