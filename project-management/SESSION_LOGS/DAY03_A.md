# Day 03 — Session A: Architecture design

**Goal:** Decide component boundaries, data flow and persistence before any production code.
**Agents/models:** Principal Architect, Claude Opus 5.5 (main session). Architecture is Tier 1 work and wasn't delegated.

## Decisions taken (written up in Session B as ADR-0001 to ADR-0006)
1. Functional core / imperative shell. The SW is the single writer with a serialised queue (load → reduce → persist → effects).
2. Hybrid storage: `storage.local` (hot, small), IndexedDB (segments, history), `storage.session` (UI snapshot). Answers PRD OQ-2.
3. UI state is pushed via the snapshot, not ports.
4. Versioned envelope; per-sender allowlists; single-use overlay nonce.
5. No network: CSP `connect-src 'none'`; AI is an interface with a mock provider.
6. Timing: persisted timestamps + event-time evaluation + one 30 s tick only during sessions.

## Design inputs used
- FEASIBILITY SD-1 to SD-11 and §7 (spike anti-patterns).
- PRD FR/NFR/AC, BR-1 to BR-8, D-004/005/006/010/011/012.
- Day 2 owner observation: an account-settings page appeared in a real log, so credential/settings path patterns were added to the exclusion step.

## Next action
Session B: write the documents.
