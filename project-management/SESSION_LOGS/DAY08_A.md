# Day 08 — Session A: Task model and parser spec

**Agents/models:** Principal Architect. Main session on **Claude Opus 5** from today (owner's `/model`; Fable 5.2 on Day 07 Session C, Opus 5.5 before that).

## Output
[docs/PARSER_SPEC.md](../../docs/PARSER_SPEC.md) v1.0 (D-024): principles, input/output types, the 8-step pipeline, the duration grammar, the site dictionary shape and V1 contents, objective and label extraction, keyword derivation, clamps, the 15 warning codes, the AC-01 expectation and the test-corpus requirements. Linked from ARCHITECTURE §5.2.1.

## Decisions
- **Privacy:** the sentence is parsed in memory and never persisted; only draft fields are.
- **Nothing silent:** every guess, default, clamp or skip raises a warning shown next to that field.
- **BR-5:** a clock target that has already passed does **not** roll to tomorrow; it asks the user.
- **Sensitive sites are never allowlisted**, even when the user names them (exclusion wins).
- **Keywords are the user's own words.** No synonym expansion in V1 (that's the optional AI, P2).
- **The site dictionary carries `mixedUse`**, which the Day 11 classifier needs.
- **A parse never fails:** an unparseable sentence yields a safe draft plus warnings.
- English only in V1; other languages become the task label unchanged.

## Next action
Session B: implementation plus the fixture corpus (delegated to an implementer subagent).
