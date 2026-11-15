# Day 02 — Session A: Chrome API research

**Goal:** Establish platform facts from official sources before building spikes.
**Agents/models:**
- Research: subagent, `model: sonnet` (exact version unknown). Read-only, official sources only. 104,408 tokens reported by the harness.
- Orchestrator / Architect: Claude Opus 5.5.

## Tasks
18 questions (14 Chrome, 4 Android), each answered with a source URL and confidence level.

## Key findings (full table in docs/FEASIBILITY.md §1, §5)
- Confirmed: `tabs` warning wording, notifications max 2 buttons, `sidePanel.open()` needs a gesture, offscreen `AUDIO_PLAYBACK`, SW 30 s idle / 5 min event rules.
- New: `alarms.persistAcrossSessions` (Chrome 150+). Offscreen audio documents close after 30 s of silence. Notification clicks are **not** a documented gesture for `sidePanel.open`. `--load-extension` was removed from branded Chrome 137+.
- Not documented: `chrome.idle` minimum interval, macOS `locked`, commands on `chrome://` pages, incognito side panel. These went to the manual checklist.

## Next action
Session B spikes.
