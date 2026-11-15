# Owner manual checks (need a person and real, visible Chrome)

| # | From | Step | Expected / record |
|---|---|---|---|
| M20 | ARCH §13 V7 | Build (`npm ci && npm run build`), load `dist/` unpacked in Chrome, open the side panel, then click into a page and back into the panel a few times | Note whether the side panel taking focus makes the browser look unfocused. Until a session engine exists, just confirm the panel opens from the toolbar icon. The automated part arrives Day 09 |
| M21 | UX-6 | With `dist/` loaded and the icon pinned, look at the toolbar in Chrome's light and dark themes | Is the icon visible and clear in both? (The badge text is added on Day 13) |
| M22 | SD-1 | Only if you approve the Chrome for Testing 120 download (about 150 MB from Google): the architect runs the smoke test and platform probe on it | Approve or decline |

Earlier spike checks still open: see `spikes/day02-feasibility/MANUAL_CHECKLIST.md` (M2, M4, M5, M8, M11, M13, M16–M19, M7 muted).
