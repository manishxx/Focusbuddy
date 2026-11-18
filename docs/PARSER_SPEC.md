# Focus Buddy — task parser specification (V1)

| Field | Value |
|---|---|
| Status | **v1.2, Day 08 (D-024 to D-026).** v1.2 applies the independent review: §5.2, §7, §8.1, §9.2, §10 |
| Implements | PRD FR-T1–T4, BR-5, AC-01; UX_GUIDELINES F2; API_CONTRACTS `parse.intent` |
| Module | `src/core/parser/` (pure: no `chrome`, no DOM, no clock, no network, no AI) |
| Output | `{ draft: SessionDraft, warnings: ParseWarning[] }`, shown in an editable form before Start (FR-T2) |

---

## 1. Principles

1. **Nothing is inferred silently.** Every field the parser guesses, defaults or changes raises a warning that the form shows next to that field (UX F2 step 2).
2. **Deterministic.** Same input plus same `now` gives the same output. No AI (that's FR-T5, P2), no network, no randomness.
3. **The sentence is never stored.** It's parsed in memory; only the resulting draft fields are persisted (DATA_MODEL minimisation). `parse.intent` stores nothing.
4. **Partial success beats failure.** An unparseable sentence still yields a usable draft: the whole text becomes the task label (truncated), with defaults elsewhere and warnings.
5. **English V1.** Other languages are out of scope and are not detected; the sentence still becomes the task label.
6. **Low cognitive load.** At most one warning per field, and the clearest one wins.

## 2. Input and output

```ts
parseIntent(text: string, ctx: ParseCtx): ParseResult

type ParseCtx = {
  now: number;            // epoch ms, injected (the parser never reads a clock)
  tzOffsetMin: number;    // minutes to add to UTC for local time, injected
  defaults: { plannedMin: number; mode: Mode };   // from prefs
  sites: SiteDictionary;  // bundled, injected
};

type ParseResult = {
  draft: SessionDraft;    // SessionConfig & { plannedMin } — validated by the Day 06 validators
  warnings: ParseWarning[];
};

type ParseWarning = {
  code: WarningCode;
  field: "plannedMin" | "allowedHosts" | "objective" | "taskLabel" | "keywords";
  data?: { value?: string; minutes?: number; names?: string[] };  // never the whole sentence
};
```

`text` is trimmed, limited to 1,000 characters (longer is rejected by the envelope validator), and Unicode-normalised to NFC. Control characters and Unicode format/separator characters (`\p{Cf}`, `\p{Zl}`, `\p{Zp}`) are stripped before parsing, as the Day 06 rules require.

## 3. Pipeline (in order; each step consumes the spans it matched)

1. **Normalise:** NFC, strip the characters above, collapse whitespace, lowercase a parsing copy (the original casing is kept for the label and the objective).
2. **Duration** (§4) → `plannedMin`; the matched span is removed from the label text.
3. **Sites** (§5) → `allowedHosts`.
4. **Objective** (§6) → `objective`.
5. **Mode** (§7) → `mode`, if stated.
6. **Task label** (§8) ← what's left.
7. **Keywords** (§9) ← derived from the label and objective.
8. **Validate and clamp** (§10) → warnings; the draft always validates.

## 4. Duration → `plannedMin` (FR-T1, BR-5)

**Accepted forms** (case-insensitive, any position):

| Form | Examples | Result |
|---|---|---|
| Hours | `3 hours`, `3h`, `3 hrs`, `2 hour` | 180, 180, 180, 120 |
| Fractional hours | `1.5h`, `1,5 h`, `2.25 hours` | 90, 90, 135 |
| Minutes | `90 min`, `90 minutes`, `45m`, `90mins` | 90, 90, 45, 90 |
| Combined | `1h30`, `1h 30m`, `1 hour 30 minutes`, `2h15` | 90, 90, 90, 135 |
| Words | `half an hour`, `an hour`, `one hour`, `two hours`, `ninety minutes`, `a couple of hours` | 30, 60, 60, 120, 90, 120 |
| Half-hour compounds (§4.1) | `an hour and a half`, `two and a half hours`, `1 hour and a half` | 90, 150, 90 |
| Clock target | `until 5pm`, `till 17:00`, `until 5:30 pm`, `by 9am`, `until noon`, `until midnight` | see below |
| Range | `for the next 2 hours` | 120 |

Number words are supported for one to twelve, plus `fifteen`, `twenty`, `thirty`, `forty-five`, `sixty`, `ninety`.

**Clock targets** use `now + tzOffsetMin`:
- The target is today's local time. If that moment is **at or before `now`**, the parser does **not** silently use tomorrow: `plannedMin` falls back to the default and the warning `until_passed` asks the user (BR-5).
- Otherwise `plannedMin = round((target − now) / 60 000)`, then clamped by §10.
- `noon` = 12:00, `midnight` = 24:00 today (so `until midnight` at 22:00 gives 120).
- A bare `until 5` is ambiguous and is **not** treated as a time: no duration, warning `duration_missing`.

**Conflicts:** if more than one duration form matches, the **first** one in the text wins, and the warning `duration_conflict` lists what was ignored.

**None found:** `plannedMin = ctx.defaults.plannedMin`, warning `duration_defaulted` (UX F2 shows it on the Length field).

### 4.1 Compound and leftover rules (D-025)

- `<N> and a half hours`, `an hour and a half`, `half an hour` are single durations. The **whole** phrase, including `and a half`, is consumed by the duration span, so no fragment can reach the label or the keywords.
- `12pm` = 12:00 and `12am` = 00:00 (so `until 12am` has already passed today; `until midnight` = 24:00 has not).
- Conflict resolution, made precise: the first match **that carries a value** sets `plannedMin`. If the very first match is a clock target that has passed → `until_passed`. If no match carries a value → `duration_missing`. Otherwise, if more than one match was found → `duration_conflict`, listing at most three ignored forms, each ≤ 24 characters.
- A duration span absorbs up to three preceding lead words (`for`, `the`, `next`, `about`, `around`, `in`, `of`, `within`, `roughly`, `maybe`, `over`).
- Durations with absurd magnitudes are matched and then clamped by §10 (`for 9999 hours` → 480 with `duration_clamped_max`), never left to leak into the label (review F11).
- `ParseCtx.defaults.plannedMin` is the constant **60** (`DEFAULT_PLANNED_MIN`). `Preferences` has no default-length field in V1, and adding one would be a DATA_MODEL change.

## 5. Sites → `allowedHosts` (FR-T3)

A bundled dictionary maps spoken names to hosts. **Minimum 30 entries**, each with:

```ts
type SiteEntry = {
  host: string;           // normalised: lowercase, no "www.", validator-safe
  names: string[];        // spoken forms, lowercase
  mixedUse: boolean;      // the classifier needs the title to judge (FR-C3)
};
```

**V1 dictionary** (names abbreviated here; `mixedUse` marked \*):

- **Study and reference:** Google Scholar, Google Docs, Google Drive, Google Classroom, Google Slides, Google Sheets, Wikipedia\*, Khan Academy, Coursera, edX, JSTOR, arXiv, PubMed, Overleaf, Notion, Obsidian (`obsidian.md`), Zotero, Quizlet, Anki (`ankiweb.net`), Desmos, Wolfram Alpha
- **Developer:** GitHub\*, GitLab, Stack Overflow, MDN, Python docs, npm, Codecademy, LeetCode, Replit, Hugging Face, Kaggle
- **AI assistants:** Claude, ChatGPT, Gemini, Perplexity
- **Writing and productivity:** Grammarly, Trello, Asana, Linear, Jira, Confluence, Figma, Miro, Canva\*
- **Communication (allowed only if the user names it):** Slack, Zoom, Google Meet, Teams, Discord\*
- **Mixed-use media:** YouTube\*, Reddit\*, Twitch\*, Medium\*, Substack\*, X/Twitter\*, LinkedIn\*, Instagram\*, TikTok\*, Facebook\*, Netflix\*, Spotify\*

### 5.2 Names must not be ordinary words (D-026, review F5)

A spoken name is only in the dictionary if it is unambiguous in a study sentence. Single words that are ordinary English (`medium`, `zoom`, `scholar`, `classroom`, `wiki`, `khan`, `insta`, `linear`, `teams`, `meet`, `indeed`, `chase`, `x`) are **not** names; those sites stay reachable through their unambiguous forms (`medium.com`, `zoom.us`, `google scholar`, `google classroom`, `wikipedia`). A wrong host is worse than a missing one, which the user can add (FR-T4).

A name matches only on a **word boundary**. Longer names are matched first, so "google scholar" wins over "google". `mixedUse` is part of the dictionary because the classifier (Day 11) needs it; the parser only copies the host.

**Bare domains** in the sentence (`example.com`, `docs.example.com/x`) are accepted: the host is extracted and normalised, the path dropped. Anything that fails the Day 06 host rules is ignored with the warning `site_unrecognised`.

**Sensitive sites are never added.** If a named site is on the built-in sensitive list (banking, health, webmail…), it's dropped with the warning `site_sensitive_skipped`. Exclusion always beats an allowlist (§5.3 step 1).

**Cap:** 50 hosts (validator limit). Extras are dropped with `sites_truncated`. Duplicates are removed.

**Unknown proper nouns are not guessed.** "I'll use Zork" doesn't become `zork.com`; it stays part of the label.

### 5.1 Bare-domain safety (D-025)

An **IPv4 literal** is accepted as a host (octets 0–255); anything else that merely looks numeric raises `site_unrecognised`. A match preceded by `@` (an email address) or carrying a `:port` is **not** a host (review F8, F9). Otherwise a bare domain is accepted **only** if its last label is in a bundled common-TLD list (`com org net edu gov mil int io ai dev app co me info biz xyz md uk de fr ca au nz in jp cn ru br mx nl se no dk fi pl es it ch at be ie pt gr il za kr tw hk sg tr ua cz ro hu eu us` plus the TLDs of dictionary hosts). Otherwise it raises `site_unrecognised` and is **not** added, because silently inventing a host breaks principle 1. So `node.js` and `wibble.zzz` warn rather than becoming hosts; `example.com` is accepted.

The sensitive-site list lives in **`src/core/exclusions/sensitive.ts`** as the single source of truth. The Day 11 classifier extends that module instead of keeping a second list.

## 6. Objective → `objective` (FR-T1)

Trigger verbs: `finish`, `complete`, `read`, `write`, `revise`, `review`, `study`, `learn`, `draft`, `submit`, `prepare`, `practise`/`practice`, `solve`, `watch`, `summarise`/`summarize`, `outline`, `edit`, `fix`, `build`, `understand`.

- The objective is the clause from the verb to the end of that clause, cut at a boundary: `.` `;` `,` or the words `and then`, `then`, `so that`, `because`, `i have`, `i'll use`, `using`, `help me`.
- Original casing is kept, with the verb phrase intact: "Finish the first four chapters".
- Length is capped at 300 characters (validator), with `objective_truncated` when cut.
- If no trigger verb appears, `objective` is `""` and the warning `objective_missing` is raised (the form asks for it, since it's used in recovery messages).

## 7. Mode

**Mode is matched before the objective step**, and its span is blanked from the objective clause, so "study for 2 hours in strict mode" sets the mode and leaves no "in strict mode" debris (review F6). `gentle`, `adaptive` or `strict` is recognised only as an explicit phrase: `<mode> mode` or `be <mode>` ("gentle mode", "be strict"). A bare "gentle" or "strict" in ordinary prose ("study gentle topics") is **not** a mode (D-025). Otherwise `ctx.defaults.mode` with no warning (the form shows the mode anyway).

## 8. Task label → `taskLabel`

- Start from the text with the duration, site, objective and mode spans removed.
- Drop leading filler: `i want to`, `i need to`, `i'd like to`, `help me`, `please`, `today`, `let's`, `i am going to`, `i'm going to`, `my plan is to`.
- Drop trailing filler: `help me stay focused`, `and intervene when i get distracted`, `please`, `thanks`.
- Collapse whitespace, strip orphan punctuation, keep the original casing, and capitalise the first letter.
- Cap at 120 characters (validator), warning `label_truncated`.
- **If the result is empty** (fewer than 2 characters), fall back in order: the objective text, then the whole cleaned sentence (truncated), then the fixed string "Focus session". The warning `label_fallback` is raised, except for the objective case.
- The subject used for keywords is the label with the trigger verb and articles removed.

### 8.1 The label is the subject, not the goal (D-025)

The confirm form shows Task and Goal as separate fields, and the PRD reference session has Task "Study Pattern Recognition" with Goal "Finish chapters 1–4". So:

1. **Derive a subject** from the objective: drop the trigger verb, leading determiners and quantifier phrases (`the first four chapters of`, `my`, `a`, `some`, `all of`), and trailing time words (`today`, `tonight`, `tomorrow`, `this week`). Prefer a capitalised proper-noun phrase when the objective contains one.
2. **Never use a leftover subordinate clause as the label.** If what's left starts with a subordinating conjunction (`because`, `since`, `so that`, `as`, `while`, `after`, `before`, `due`, `although`), discard it.
3. **Prefer the derived subject over the objective.** If the label would otherwise equal the objective (compared case-insensitively, ignoring punctuation), use the subject. Only when no subject can be derived does the label keep the objective text, and then `label_fallback` is raised (so "study for 2 hours" gives the label "Study" and asks the user to name the task). This is the single case where label and objective may match (review F15).
4. **Strip dangling function words from either end** of a candidate label: leading or trailing joiners, determiners, prepositions, conjunctions and question words (`can`, `could`, `should`, `why`, `what`, `how`, `do`, `does`, `then`, `actually`, `and`, `thing`). A label must never be only such words ("Can I", "Actually", "Check then", "For chemistry"), and never start with one (review F1, F2).
5. **Numeric-only leftovers are never labels or keywords** ("For 9999", "1e9").
4. Only then apply the §8 fallback chain.

`parse_failed` aside, the label is always something the user would recognise as the name of their task.

## 9. Keywords → `keywords` (FR-C4 input)

- Tokenise the label and objective: split on non-letters/digits, lowercase, drop a stop list (articles, pronouns, prepositions, the trigger verbs, `chapter`, `chapters`, `page`, `pages`, and bare numbers).
- Keep tokens of 3 or more characters; de-duplicate; preserve order.
- Also add the whole multi-word subject phrase (for example `pattern recognition`), so the classifier can match a phrase.
- Cap at 12 keywords here (the validator allows 40; the rest is room for the user), each 1–100 characters, with `keywords_truncated` when cut.
- Keywords are what the classifier matches titles against, so they must be the user's own words, never expanded by the parser.

### 9.2 Keyword quality, part 2 (D-026, review F3, F4, F17)

- **Phrase candidates are filtered too.** A phrase whose first or last token is weak, or which is made only of weak tokens, is rejected. So `for the biology exam`, `in strict mode`, `and write`, `chapter 5 page 9` never become keywords.
- **Generic web and filler words are blocked** as single keywords, because a keyword like `home` plus a mixed-use host would classify a site's home page as RELEVANT (FR-C6): `com`, `www`, `http`, `https`, `page`, `pages`, `home`, `site`, `website`, `web`, `online`, `news`, `video`, `videos`, `work`, `thing`, `things`, `stuff`, `focus`, `why`, `how`, `what`, `notes` only when it is the sole token of a phrase, plus clock-shaped tokens (`5pm`, `17:00`).
- **Sensitive spans are blanked from the keyword sources**, so a skipped private site's name can't be persisted as a keyword (review F17). The **task label may still contain it**, deliberately: the label is the user's own naming of their task, shown in an editable field before anything is saved, whereas a keyword is matched against page titles, where a private site's name would both leak and misclassify.

### 9.1 Keyword quality (D-025)

A weak keyword causes false RELEVANT results on Day 11, which is the failure the PRD cares most about. So:

- **Phrase keywords** come only from (a) a capitalised proper-noun phrase of 2–4 words, or (b) the derived subject when it is 2–4 words. Never from arbitrary leftover text.
- **Single keywords** exclude, in addition to the stop list: time words (`today`, `tomorrow`, `tonight`, `yesterday`, `week`, `month`, `morning`, `afternoon`, `evening`, `soon`, `later`, `due`, `deadline`), quantity words (`half`, `first`, `second`, `last`, `next`, `few`, `couple`) and the filler dropped in §8.
- Words that come only from a dropped filler phrase or a discarded subordinate clause are never keywords.

## 10. Validation, clamps and warning precedence

- `plannedMin` is clamped to 5–480. Below 5 → 5 with `duration_clamped_min`; above 480 → 480 with `duration_clamped_max` (BR-5).
- The draft is then run through the Day 06 `validateSessionConfig`-style validators. The safe draft uses a **hard-coded known-good mode** (`gentle`), never `ctx.defaults.mode`, so it can never itself be invalid (review F7). **If validation fails, the parser falls back to that minimal safe draft** (label fallback, default duration, no hosts, no keywords) with the warning `parse_failed`, and never returns an invalid draft.
- At most one warning per field; precedence within a field is the order of the codes in §11.

## 11. Warning codes

| Code | Field | Meaning | UX message key |
|---|---|---|---|
| `until_passed` | plannedMin | Clock target already passed today (BR-5) | `parse.untilPassed` |
| `duration_conflict` | plannedMin | Several durations found; the first was used | (new key needed) |
| `duration_clamped_max` | plannedMin | Over 8 hours | `parse.durationClamped` |
| `duration_clamped_min` | plannedMin | Under 5 minutes | (new key needed) |
| `duration_defaulted` | plannedMin | None found | `parse.durationDefaulted` |
| `duration_missing` | plannedMin | A time-like phrase was too vague ("until 5") | `parse.untilPassed` (reworded) or a new key |
| `site_sensitive_skipped` | allowedHosts | A private-category site was named and skipped | (new key needed) |
| `site_unrecognised` | allowedHosts | A site-like word couldn't be mapped | (new key needed) |
| `sites_truncated` | allowedHosts | Over 50 | (new key needed) |
| `objective_missing` | objective | No goal found | (new key needed) |
| `objective_truncated` | objective | Over 300 characters | (new key needed) |
| `label_truncated` | taskLabel | Over 120 characters | (new key needed) |
| `label_fallback` | taskLabel | Nothing usable; a fallback was used | (new key needed) |
| `keywords_truncated` | keywords | Over 12 | (new key needed) |
| `parse_failed` | taskLabel | Internal validation failed; a safe draft was returned | (new key needed) |

New message-bank strings are added in Session B and must pass the Day 04 lint (no shaming, ≤ 25 words, no `{task}` leak in generic variants).

## 12. Reference sentence (AC-01)

> "I want to finish the first four chapters of Pattern Recognition today. I have three hours. I'll be using Claude, Google Classroom, Google Scholar, and YouTube. Help me stay focused and intervene when I get distracted."

Expected:
- `plannedMin` = 180
- `allowedHosts` ⊇ `claude.ai`, `classroom.google.com`, `scholar.google.com`, `youtube.com`
- `taskLabel` contains "Pattern Recognition"
- `objective` contains "first four chapters" (or "chapters 1–4")
- `keywords` include `pattern recognition`
- warnings: none for duration or sites

## 13. Test corpus (Session B/C, ≥ 40 sentences)

The fixture file covers, at minimum:
- every duration form in §4, including `until` before and after now, `until 5` and conflicts;
- sentences with 0, 1, 4 and 60 sites; bare domains; unknown names; a sensitive site;
- objectives with and without trigger verbs, and over-long ones;
- empty, whitespace-only, emoji-only, 1,000-character, and non-English sentences;
- punctuation-heavy and injection-shaped input (`<script>`, `{{}}`, `__proto__`, a bidi override);
- the reference sentence (AC-01).

Every fixture asserts the full draft and the exact warning set. Fixtures are data, so the corpus can grow without code changes.
