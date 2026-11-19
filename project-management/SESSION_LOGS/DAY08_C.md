# Day 08 — Session C: Parser fixtures, verification, independent review

**Agents/models:**
- **Reviewer:** subagent, `model: opus` (exact version unknown). A different agent from the implementer. Round 1: 201,029 tokens reported.
- **Implementer fix rounds:** the same subagent as Session B. 469,142 tokens reported at the last round (cumulative or not: unknown).
- **Probing, decisions and verification:** Principal Architect, Claude Opus 5.

## Review results
| Round | Verdict | Major | Minor |
|---|---|---|---|
| Review 1 (efc9a5e) | APPROVE WITH CHANGES | 7 | 10 |
| Re-check (e55212f) | **APPROVE** | 0 (F11 partial) | residue list |

The re-check was interrupted once by an Opus usage limit and resumed with its work intact. It re-ran about 250 sentences plus 6,000 fuzz cases and killed 18 of 19 mutants (the survivor, a proper-noun lower bound, was then covered by a test). Its own measurements: parser ≈ 0.43 ms for a 1,000-character sentence, and no warning data ever carried sentence text.

Its quality verdict, in its words: of ten ordinary study sentences, nine gave a Task field it would accept unedited; keywords are the remaining compromise (a recall limit for the Day 11 classifier, not a trust problem).

The reviewer wrote its own harness: about 250 hand-written sentences plus 4,000 fuzz cases.

**The major cluster was quality of the task name and keywords**, which the fixtures had ratified as correct:

| Input | Before | After |
|---|---|---|
| `Revise for the biology exam, 90 minutes, using Khan Academy` | label "For the biology exam" | "Biology exam" |
| `Can I study maths for an hour?` | "Can I" | "Maths" |
| `read the news for 1h` | keyword `news` | no keywords |
| `read a book about the home page design` | keywords incl. `home` | `book`, `design` |
| `work on medium difficulty problems` | host `medium.com` added | no host |
| `study for 2 hours in strict mode` | mode ignored, "Strict mode" label | mode strict, label "Study" |
| `email a@b.com for 10 min` | host `b.com` added | no host |
| `revise … for 9999 hours` | 60 min, "9999" in the label | 480 min + clamp warning |

One finding (F15) was a **self-contradiction in my own spec**, now fixed: §8.1 said the label must never equal the objective while also describing a fallback that does exactly that.

F7 was a real correctness bug: the "safe draft" that exists to guarantee a valid result could itself be invalid.

## Decisions (D-026, PARSER_SPEC v1.2)
- New §5.2: ordinary single words are not spoken site names.
- New §9.2: phrase and generic keyword filtering, because a keyword like `home` plus a mixed-use host would classify that site's home page as RELEVANT (FR-C6).
- §8.1: strip dangling function words from both ends; the no-subject fallback is the single case where label and objective may match.
- §5.1: IPv4 accepted explicitly; email and `:port` matches are not hosts.
- §7: mode is matched before the objective step.
- §10: the safe draft uses a fixed `gentle`.
- A sensitive site's name may remain in the **task label** by design (it's the user's own naming, shown in an editable field), while keywords blank it, because keywords are matched against page titles.

## Accepted implementer readings
- `book` and `design` stay keywords (plausible topic words).
- `study 1e9 minutes` keeps its goal text as the label rather than inventing one.
- A dot after a 1–3 character token doesn't end the objective clause (so "Read Dr. Smith's Ph.D. thesis" survives); `?`/`!` are stripped from a label's tail.

## Architect verification (own probe, 12 + 12 sentences, after each round)
Every reviewer example was re-run and confirmed fixed. AC-01 is stable: label "Pattern Recognition", objective "finish the first four chapters of Pattern Recognition today", the four hosts, keywords `pattern recognition`/`pattern`/`recognition`, 180 minutes, no warnings. `write the essay until 12pm` correctly gives `until_passed` when 12pm has gone and 120 minutes when it hasn't.

## Checks (architect's own runs)
| Check | Result |
|---|---|
| `npm run ci` | exit 0: **1,229 tests passed**; lines 99.49 %; every parser file ≥ 97.4 % lines; message lint PASS (185 strings) |
| `npm run e2e:session` | 44/44, with AC-01 parsed through a real extension page and a session started from the parsed draft |
| `npm run e2e:smoke` | `"ok": true` |
| Reviewer's independent runs | `npm run ci` exit 0; parser ≈ 0.40 ms for a 1,000-character sentence; 0 failures in 4,000 fuzz cases; no warning data ever carried sentence text |

## Final round (D-027, PARSER_SPEC v1.3)
After the re-check, eight residue items were closed and verified by the architect's own probe:

| Input | Result |
|---|---|
| `study 9999999999 hours` | 480 min + clamp warning; no number in the label or keywords |
| `solve the problem set for calculus for 1 hour` | keywords `problem set`, `problem`, `set`, `calculus` (no dead `problem set for calculus` phrase) |
| `study web development for 1 hour` | keyword phrase `web development` kept |
| `Why don't I just study` | label "Study"; no `don` keyword |
| `Why can't I focus? study maths for 1h` | label "Maths" |
| `read notes on 1.2.3 for 10 min` | `site_unrecognised`, no host |
| `study the Treaty of Westphalia for 1 hour` | phrase `treaty of westphalia` kept |

Also accepted: `focus` and its forms are treated as the product's words, not a user topic, so "improve focus" asks the user to name the task.

## Carried forward
- The side panel doesn't call `parse.intent` yet (Day 13); `WARNING_MESSAGE_KEYS` is the hand-off.
- `parse_failed` is unreachable from user input by design.
- Jira's `atlassian.net` host depends on how the Day 11 classifier matches tenant subdomains.
