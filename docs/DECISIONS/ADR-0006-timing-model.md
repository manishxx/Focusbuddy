# ADR-0006: Timing model: persisted timestamps, event-time evaluation, a single 30 s tick during sessions

- Status: Accepted (Day 03, after independent review). Builds on D-011, SD-1
- Context: In-memory timers die with the SW. `chrome.alarms` has a 30 s minimum period (Chrome ≥ 120) and woke a stopped SW in Day 2 tests. No polling is allowed when there's no session.
- Decision: Timestamps in persisted state are the source of truth. Thresholds are evaluated on every observation and on an `fb.tick` alarm (30 s) that exists only while a session is ACTIVE, plus one-shot alarms `fb.sessionEnd`, `fb.breakEnd`, `fb.breakPrompt` and `fb.stalePause`. The snapshot is published only on change. Alarms are re-created idempotently on every SW start. `persistAcrossSessions` is passed only on Chrome ≥ 150. Accepted threshold-onset tolerance: +30 s.
- Consequences: (+) correct after restarts; nothing runs with no session. (−) Up to 30 s latency for purely time-based transitions when no events occur.
