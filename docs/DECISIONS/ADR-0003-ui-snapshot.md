# ADR-0003: UI state via a published snapshot in chrome.storage.session

- Status: Accepted (Day 03, after independent review)
- Context: The side panel (per window), options page and intervention page need live session state. The SW may be asleep. Long-lived ports keep the SW alive.
- Decision: After every state change the SW writes a compact `UiSnapshot` (≤ 4 KB) to `storage.session` under `ui.snapshot`. Pages read it on load and subscribe to `storage.onChanged`. Countdowns run locally from the snapshot's `at`.
- Consequences: (+) works while the SW is asleep, consistent across windows, simple. (−) `storage.session` is cleared on browser restart, so the SW republishes at startup. The snapshot must stay small and free of raw titles (SECURITY T1).
- Alternatives rejected: polling from pages (wakes the SW); runtime ports (keep-alive cost, reconnect logic).
