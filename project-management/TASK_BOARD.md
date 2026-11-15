# Task board

## Done (Day 01)
- [x] D01-A1 Analyse vision → journeys J1–J10 (SESSION_LOGS/DAY01_A.md)
- [x] D01-B1 Write PRD v0.x (docs/PRD.md)
- [x] D01-B2 Create project-management skeleton
- [x] D01-C1 Independent PRD review (subagent) and fixes (17 findings applied → PRD v0.3)

## Next (Day 02 — Feasibility)
- [ ] D02-A1 Check official docs: `tabs`, `windows`, `idle`, `sidePanel`, `offscreen`, `notifications`, `alarms`, `scripting`, `permissions` (optional host permissions)
- [ ] D02-B1 Spike: minimal MV3 extension logging tab activation/title updates across 2 windows
- [ ] D02-B2 Spike: `chrome.idle` states with a 15 s threshold
- [ ] D02-B3 Spike: side panel persists across tab navigation
- [ ] D02-B4 Spike: offscreen-document audio playback
- [ ] D02-B5 Spike: overlay injection via optional host permission vs `activeTab` (answers PRD OQ-1)
- [ ] D02-B5b Spike: does a notification click allow `sidePanel.open()`? (PRD OQ-7); 2-button limit on macOS; `getPermissionLevel`
- [ ] D02-B5c Spike: `chrome.commands` global shortcut on `chrome://` pages; side panel in incognito spanning mode (OQ-8)
- [ ] D02-B5d Confirm minimum Chrome 120 (alarms 30 s period) — PRD NFR-11
- [ ] D02-B6 Desk note: Android usage-access/background limits/Play policy
- [ ] D02-C1 Write docs/FEASIBILITY.md; owner runs the manual spike checklist in real Chrome

## Backlog
See [FEATURE_REGISTRY.md](FEATURE_REGISTRY.md) and [30_DAY_ROADMAP.md](30_DAY_ROADMAP.md).
