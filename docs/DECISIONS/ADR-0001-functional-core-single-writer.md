# ADR-0001: Functional core, imperative shell; the service worker is the single writer

- Status: Accepted (Day 03, after independent review)
- Context: MV3 service workers stop after 30 s idle and can be stopped at any time (FEASIBILITY §1.7, §3). Several contexts (panel, options, intervention page, overlay) can trigger changes. Day 2 showed concurrent writes clobbering each other.
- Decision: All decision logic is pure TypeScript in `src/core` with an injected clock. The SW is the only context that mutates state. It processes inputs through one serialised queue: load → reduce → persist → effects. UI pages send validated commands and read a published snapshot.
- Consequences: (+) the core is unit-testable without Chrome, there are no write races, and restarts are safe. (−) A small amount of boilerplate (an effect type per action), and the UI shows changes only after the SW publishes, typically within 50 ms.
- Alternatives rejected: state in each UI page (races, can't survive the panel closing); a long-lived port (keeps the SW alive and breaks on restarts).
