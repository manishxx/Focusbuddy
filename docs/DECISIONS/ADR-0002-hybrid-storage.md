# ADR-0002: Hybrid local storage: chrome.storage.local + IndexedDB + storage.session

- Status: Accepted (Day 03, after independent review). Answers PRD OQ-2
- Context: Small hot state (prefs, active session) and append-heavy activity data have different access patterns. `storage.local.set` rewrites a whole value; a growing activity array would cost O(n) per write. Local-first is required, with no remote DB.
- Decision: `chrome.storage.local` holds prefs, overrides, the active session, meta and the diagnostic log. IndexedDB (`fb`) holds segments, interventions and session history (the classification cache was dropped in review: rules take < 5 ms). `storage.local` is restricted to trusted contexts at startup, and no titles are stored anywhere (D-015). `chrome.storage.session` holds the UI snapshot.
- Consequences: (+) cheap appends, range deletes and bounded writes; onChanged convenience for small state. (−) Two backends and two migration paths; cross-store operations aren't atomic, which DATA_MODEL §4 handles with idempotent reconciliation.
- Alternatives rejected: storage.local only (write amplification); IndexedDB only (loses onChanged for UI and prefs, more code); a remote DB (not needed, a privacy risk).
