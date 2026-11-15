# Day 05 — Session A: Stack and engineering standards

**Goal:** Pick the toolchain and standards before the first production code.
**Agents/models:** Principal Architect, Claude Opus 5.5 (main session).

## Output
[ADR-0007](../../docs/DECISIONS/ADR-0007-toolchain-and-build.md) covers:
- Node ≥ 24, npm with exact pins and a lockfile.
- TypeScript 6.0 strict; Vite 8 three-part build; React 19.
- ESLint 9 with project guard rules; Vitest 4 with an 80 % core threshold.
- Manifest and secret guards; GitHub Actions.

## Decisions
- **Dependencies:** only versions published ≥ 14 days ago, checked with `npm view <pkg> time` on 2026-11-15.
  - TypeScript 6.0.3, not 7.0.2: typescript-eslint 8.72.1 supports `<6.1`.
  - ESLint 9.39.5, not 10.x: `@eslint/js` has no 10.x release.
  - vitest 4.1.12: 5.x is newer than 14 days.
- **No CRXJS / extension plugin:** a small custom build script instead.
- **Message bank** moved from `docs/ux/` to `src/core/messages/`, so there's one source. `lint-messages.mjs` moved to `scripts/`.
- **Chrome for Testing 120 not downloaded:** the owner hasn't approved it, so the minimum-version test is **skipped** and recorded as such.

## Next action
Session B: scaffold (delegated to an implementer subagent). In parallel, the architect writes the platform-facts probe.
