// Probe service worker. Functions are called from the runner via worker.evaluate.
self.probe = {
  async setAccessLevel() {
    try { await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }); return "ok"; }
    catch (e) { return "error: " + e.message; }
  },
  async seed() { await chrome.storage.local.set({ probeSecret: "local-value" }); return "seeded"; },
  async offscreenSender() {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["AUDIO_PLAYBACK"], justification: "probe" });
    }
    const reply = await chrome.runtime.sendMessage({ probe: "who" });
    return { reply, swUrl: self.location.href, getURL: chrome.runtime.getURL("sw.js") };
  },
  async swFetch(url) {
    try { const r = await fetch(url, { cache: "no-store" }); return "allowed status " + r.status; }
    catch (e) { return "blocked: " + e.message; }
  },
  async storageSession(op) {
    if (op === "set") { await chrome.storage.session.set({ probeSession: Date.now() }); return "set"; }
    return chrome.storage.session.get("probeSession");
  },
  async idleInterval() {
    chrome.idle.setDetectionInterval(15);
    return typeof chrome.idle.getAutoLockDelay === "function" ? "set (no getter for detection interval)" : "set";
  },
  async warnings(manifestStr) {
    try { return await chrome.management.getPermissionWarningsByManifest(manifestStr); }
    catch (e) { return "error: " + e.message; }
  },
  async inject(tabId) {
    const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["overlay-probe.js"] });
    return { documentId: r.documentId, result: r.result };
  },
  reload() { setTimeout(() => chrome.runtime.reload(), 50); return "reloading"; },
};
