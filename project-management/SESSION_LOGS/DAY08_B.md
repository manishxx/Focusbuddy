# Day 08 — Session B: Parser implementation

**Agents/models:**
- Implementer: subagent, `model: opus` (exact version unknown). Two runs: 297,254 and 387,560 tokens reported (cumulative or not: unknown).
- Quality probing and decisions (D-025): Principal Architect, Claude Opus 5.

## Files
- **`src/core/parser/`:** `types.ts`, `text.ts` (normalisation and span helpers), `sites.ts` (62 entries plus the TLD gate), `duration.ts`, `objective.ts`, `subject.ts`, `label.ts`, `keywords.ts`, `parseIntent.ts`, `index.ts`.
- **`src/core/exclusions/sensitive.ts`:** 26 sensitive hosts, the single source that Day 11 extends.
- **Router:** `parse.intent` replaces its `not_implemented` entry. It reads prefs only for the default mode and falls back to defaults, so it works in safe mode; `now` and `tzOffsetMin` are injected by the shell.
- **Message bank:** 13 new `parse.*` strings (185 total, lint PASS).
- **Tests:** `tests/unit/parser/` (8 files, 273 tests, 77 fixtures), plus router tests and an AC-01 step in the session e2e.

## Architect probe → D-025 (PARSER_SPEC v1.1)
My probe of the first implementation found six quality faults that the fixtures had encoded as correct:

| Input | Before | After |
|---|---|---|
| `Write my essay for an hour and a half` | 60 min, label "Write my essay and a half" | 90 min, label "Essay" |
| `Finish the lab report because it is due tomorrow` | label "Because it is due tomorrow" | label "Lab report" |
| `Read notes on wibble.zzz for 20 min` | host `wibble.zzz`, no warning | no host, `site_unrecognised` |
| `Read the Node.js docs for an hour` | host `node.js`, no warning | no host, `site_unrecognised` |
| AC-01 | label identical to the objective | label "Pattern Recognition" |
| `study gentle topics for 30 min` | mode matched a bare "gentle" | mode unchanged |

Keyword junk (`due`, `tomorrow`, `half`, `my essay and half`) is gone, which matters because weak keywords cause false RELEVANT results on Day 11.

## Implementer judgement calls accepted
- `parse_failed` is the only warning on the safe-draft path.
- The objective fallback raises `label_fallback` (so "study for 2 hours" asks the user to name the task).
- Proper-noun phrase guards: one lowercase connector allowed (`of`, `the`, `de`…), never `and`/`or`; a run starting with a trigger verb is ignored.

## Tests (architect's own runs after the hand-back)
| Check | Result |
|---|---|
| `npm run ci` | exit 0: **1,185 tests passed**; lines 99.66 %; every parser file 100 % lines; message lint PASS |
| Architect probe (12 sentences) | All six D-025 faults fixed; AC-01 label "Pattern Recognition" |
| `npm run e2e:session` | 44/44, including AC-01 parsed through a real extension page and a session started from the parsed draft |
| `npm run e2e:smoke` | `"ok": true` |

## Carried forward
- The side panel doesn't call `parse.intent` yet; the confirm form with per-field warnings is Day 13 (`WARNING_MESSAGE_KEYS` is the hand-off point).
- `mixedUseFor()` is exported for the Day 11 classifier and currently unused.
- A label may contain the user's own script-shaped text, so the Day 13 UI must escape it (it is never rendered as HTML by the parser).
