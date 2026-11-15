# ADR-0004: Versioned, schema-validated messaging with per-sender allowlists

- Status: Accepted (Day 03, after independent review)
- Context: The Day 2 spike accepted any message from any context, so an injected script could trigger privileged actions (FEASIBILITY §7.2). Overlay responses come from untrusted pages.
- Decision: The envelope is `{v, id, type, payload, nonce?}`. A router classifies the sender (extension page / overlay / offscreen / other) and checks a per-class type allowlist. Payloads are validated against schemas (library chosen Day 05; small footprint required). Overlay responses need a single-use nonce bound to the tab. There is no external messaging surface.
- Consequences: (+) contains bugs and hostile pages; explicit contract for tests. (−) Schema maintenance for each command.
