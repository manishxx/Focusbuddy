// Day 2 feasibility spike — service worker. Throwaway code; not production.
// Every observation is appended to chrome.storage.local "log" (capped) so the
// harness and the side panel can read it, and so it survives SW restarts.

const LOG_CAP = 300;
let queue = Promise.resolve(); // serialise writes so concurrent events don't clobber each other

function log(type, data = {}) {
  const entry = { t: Date.now(), type, ...data };
  queue = queue.then(async () => {
    const { log: cur = [] } = await chrome.storage.local.get("log");
    cur.push(entry);
    await chrome.storage.local.set({ log: cur.slice(-LOG_CAP) });
  });
  return queue;
}

log("sw_start");

// --- Tabs / windows (FR-M1) ---
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  log("tab_activated", { tabId, windowId, title: tab.title, url: tab.url });
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!("title" in changeInfo) && !("url" in changeInfo)) return;
  log("tab_updated", { tabId, windowId: tab.windowId, active: tab.active, changed: Object.keys(changeInfo), title: tab.title, url: tab.url });
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => log("tab_replaced", { addedTabId, removedTabId }));
chrome.tabs.onRemoved.addListener((tabId, info) => log("tab_removed", { tabId, windowClosing: info.isWindowClosing }));
chrome.windows.onFocusChanged.addListener((windowId) =>
  log("window_focus", { windowId, none: windowId === chrome.windows.WINDOW_ID_NONE }));

// --- Idle (FR-M3) ---
chrome.idle.setDetectionInterval(15);
chrome.idle.onStateChanged.addListener((state) => log("idle_state", { state }));

// --- Alarms survive SW termination? (FR-C6, FR-S5) ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  // Research says Chrome 150+ supports persistAcrossSessions; verify the API accepts it.
  chrome.alarms.create("persist-probe", { delayInMinutes: 60, persistAcrossSessions: true })
    .then(() => log("persist_alarm_ok"), (e) => log("persist_alarm_error", { e: String(e?.message || e) }));
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => log("panel_behavior_error", { e: String(e) }));
  log("installed");
});
chrome.alarms.onAlarm.addListener((a) => log("alarm", { name: a.name, scheduled: a.scheduledTime }));

// --- Commands (FR-I11) ---
chrome.commands.onCommand.addListener((command, tab) => log("command", { command, tabUrl: tab?.url }));

// --- Notifications + sidePanel.open from notification click (OQ-7) ---
async function tryOpenPanel(source) {
  const win = await chrome.windows.getLastFocused();
  try {
    await chrome.sidePanel.open({ windowId: win.id });
    log("panel_open_ok", { source });
  } catch (e) {
    log("panel_open_error", { source, e: String(e?.message || e) });
  }
}
chrome.notifications.onClicked.addListener((id) => { log("notif_clicked", { id }); tryOpenPanel("notification_body"); });
chrome.notifications.onButtonClicked.addListener((id, idx) => { log("notif_button", { id, idx }); tryOpenPanel("notification_button"); });
chrome.notifications.onClosed.addListener((id, byUser) => log("notif_closed", { id, byUser }));

// --- Offscreen audio (FR-I9) ---
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["AUDIO_PLAYBACK"], justification: "Play a short reminder tone." });
}

// --- Message API used by side panel and harness ---
const handlers = {
  async notify({ buttons = 2 }) {
    const level = await chrome.notifications.getPermissionLevel();
    const btns = Array.from({ length: buttons }, (_, i) => ({ title: `Button ${i + 1}` }));
    return new Promise((resolve) => {
      chrome.notifications.create("", {
        type: "basic", iconUrl: "icon.png", title: "Spike notification",
        message: "Looks like we've drifted. Ready to continue?", buttons: btns, requireInteraction: true,
      }, (id) => {
        const err = chrome.runtime.lastError?.message;
        log("notif_created", { id, buttons, level, err });
        resolve({ id, level, err });
      });
    });
  },
  async playSound({ volume = 0.3, mode = "new", freq = 660 }) {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: "offscreen", cmd: "beep", volume, mode, freq });
    log("sound_result", res || { ok: false, e: "no response" });
    return res;
  },
  async injectOverlay({ tabId }) {
    const target = tabId ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
    try {
      await chrome.scripting.executeScript({ target: { tabId: target }, files: ["overlay.js"] });
      log("overlay_injected", { tabId: target });
      return { ok: true };
    } catch (e) {
      log("overlay_error", { tabId: target, e: String(e?.message || e) });
      return { ok: false, e: String(e?.message || e) };
    }
  },
  async hasHostPermission() {
    return { granted: await chrome.permissions.contains({ origins: ["<all_urls>"] }) };
  },
  async idleQuery() { return { state: await chrome.idle.queryState(15) }; },
  async clearLog() { await chrome.storage.local.set({ log: [] }); return { ok: true }; },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === "offscreen") return false; // handled by the offscreen doc
  if (msg?.type === "overlay_event") { log("overlay_event", { ev: msg.ev, tabId: sender.tab?.id }); return false; }
  const h = handlers[msg?.cmd];
  if (!h) return false;
  h(msg).then(sendResponse, (e) => sendResponse({ ok: false, e: String(e) }));
  return true;
});

chrome.permissions.onRemoved.addListener((p) => log("permission_removed", p));
chrome.permissions.onAdded.addListener((p) => log("permission_added", p));
