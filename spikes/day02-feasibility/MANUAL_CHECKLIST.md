# Day 02 manual checks (owner, real Chrome, about 10 minutes)

The automated harness runs headless Chrome. It can't click native macOS
notifications, hear sound, lock the screen, or press browser-level shortcuts.
These checks close those gaps. Results go into `docs/FEASIBILITY.md` §4.

## Setup
1. Open `chrome://extensions`, turn on **Developer mode** and click **Load unpacked**.
   Select `spikes/day02-feasibility/extension`.
2. Pin the "Focus Buddy spike" icon and click it. The side panel opens with a live event log.
3. When you're done, **remove the spike extension**. It is throwaway.

## Checks
Write **Y / N / what happened** next to each.

| # | Do this | What we want to learn | Result |
|---|---|---|---|
| M1 | Switch between a few tabs, then open a second window (⌘N) and switch back | `tab_activated` / `window_focus` appear once per switch || **Y**: `tab_activated` once per switch, real titles and URLs captured (2026-11-16 run) |
| M2 | In the second window, click the toolbar icon | Each window has its own panel open state (PRD FR-P2) | |
| M3 | Panel button **1. Show notification** | A macOS notification appears. Are the 2 buttons visible, or hidden under "Options"? || **N**: `notif_created`, `level: granted`, but **no notification visible** on macOS |
| M4 | Click the **body** of that notification | Log shows `panel_open_ok` or `panel_open_error`. This answers PRD OQ-7 | |
| M5 | Show another notification and click one of its **buttons** | Same as M4, for button clicks | |
| M6 | Panel button **2. Try notification with 3 buttons** | How many buttons are actually shown? (Docs say max 2. Headless accepted 3 without an error.) || **N/A**: no notifications visible at all (see M3) |
| M7 | Panel button **3. Play sound** | Did you hear a short beep? Repeat with system volume muted: did anything break? | |
| M8 | Open `chrome://settings`, then press **Alt+Shift+M** (check `chrome://extensions/shortcuts` if there's a conflict) | `command` appears in the log, so the shortcut works on chrome:// pages (FR-I11) | |
| M9 | Panel button **4. Request host permission** | Note the exact wording of the permission prompt. Grant it || **Y**: `{"granted":true}` from the side-panel button (runtime grant works) |
| M10 | Open any normal website, then panel button **5. Inject overlay** | The overlay appears. Buttons work during the countdown, and Escape closes it || **Y (partial)**: overlay shown, countdown reached 0 s. Escape/buttons not reported yet |
| M11 | Lock the screen (⌃⌘Q) for about 20 s, then unlock | Log shows `idle_state locked` then `active` (macOS "locked" support) | |
| M12 | Leave the mouse and keyboard alone for about 30 s | Log shows `idle_state idle` (15 s detection interval works) | |
| M13 | Allow the extension in incognito (Details → Allow in incognito), open an incognito window, click the icon. Then **turn incognito access off again** | Does the side panel open in incognito? Do incognito titles appear in the log? (The spike logs them; production must not.) (PRD OQ-8) | |
| M15 | With the panel log visible, switch to another Mac app (e.g. Finder) and back | `window_focus` with `none: true` when Chrome loses focus (FR-M8) || **Y**: `window_focus none:true` (windowId -1) on app switch, `none:false` on return |
| M16 | macOS System Settings → Notifications → Google Chrome → turn notifications **off**, then panel button 1. Turn them back on and repeat with **Focus / Do Not Disturb** enabled | Does `level` in the panel status still say `granted`? Did anything appear? (FR-I10) | |
| M17 | Show a notification and click its body | Note whether *anything* opens. SD-3 fallback check: production will open a tab | |
| M18 | Close the laptop lid for about 2 min, then reopen | `alarm` entries resume after wake; note any gap | |
| M19 | During install (step 1), read Chrome's permission dialog | Exact warning text shown for this extension | |
| M14 | Quit Chrome completely, reopen it after more than 1 minute, then open the panel | `sw_start` appears and `alarm` entries resume after restart (alarms persist) | |
