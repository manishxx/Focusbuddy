# ADR-0005: No network in V1; AI behind an interface with a mock provider

- Status: Accepted (Day 03, after independent review). Confirms D-003 and FR-A3
- Context: No paid services. Privacy requires that no browsing data leaves the device by default. Secrets can't be shipped in an extension.
- Decision: Strict extension-page CSP (`default-src 'none'`, `'self'` only; SECURITY §6). `connect-src 'self'` is used instead of `'none'` so bundled files stay loadable. The SW contains no network code (lint-enforced). The CSP isn't assumed to cover the SW's `fetch` (unverified). `AiClassifier` is an interface used only for UNCERTAIN cases; V1 ships `disabled` (default) and `mock` (tests and demo). A real provider needs a new ADR covering the backend/key design, data sent, caps and owner budget approval, and relaxes the CSP only to that origin.
- Consequences: (+) AC-10 holds by construction; zero runtime cost. (−) Classification quality depends on rules and topic vocabulary in V1.
