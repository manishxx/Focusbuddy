// Day 2 feasibility harness: loads the spike extension into the locally installed
// Chrome (separate temporary profile, headless) and records what actually happens.
// Usage: node run.mjs [--headful]   Output: results.json next to this file.
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, "../extension");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
const record = (k, v) => { results[k] = v; console.log(`• ${k}:`, JSON.stringify(v)); };

// Local pages with controllable titles (no external network).
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const title = u.searchParams.get("title") || "Untitled";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>${title.replace(/</g, "")}</title><body><p>${title.replace(/</g, "")}</p>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const pageUrl = (t) => `${base}/page?title=${encodeURIComponent(t)}`;

// A variant with host permission granted at install, to test the "permission granted" overlay path.
function makeVariant() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-spike-host-"));
  fs.cpSync(EXT, dir, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  m.host_permissions = ["<all_urls>"];
  delete m.optional_host_permissions;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2));
  return dir;
}

const puppeteerBrowsers = [];
async function launch(extDir) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-spike-profile-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !process.argv.includes("--headful"),
    enableExtensions: [extDir],
    userDataDir,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  puppeteerBrowsers.push(browser);
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"), { timeout: 15000 });
  return { browser, target, worker: await target.worker(), userDataDir };
}
const getLog = (w) => w.evaluate(async () => (await chrome.storage.local.get("log")).log || []);
const since = (log, t0) => log.filter((e) => e.t >= t0);

try {
  // ---------------- Run 1: production-like manifest (optional host permission) ----------------
  let { browser, target, worker } = await launch(EXT);
  record("chrome_version", await browser.version());
  record("extension_id", new URL(target.url()).host);

  // T1/T2: tabs, titles, multiple windows
  let t0 = Date.now();
  const pA = await browser.newPage(); await pA.goto(pageUrl("Pattern Recognition — Chapter 1 (Google Classroom)"));
  const pB = await browser.newPage(); await pB.goto(pageUrl("K Nearest Neighbors Explained - YouTube"));
  await pA.bringToFront(); await sleep(300);
  await pB.evaluate(() => { document.title = "Top 10 Football Goals - YouTube"; }); await sleep(300);
  await pB.evaluate(() => { document.title = "Top 10 Football Goals - YouTube"; }); await sleep(300); // identical title again
  await worker.evaluate((u) => chrome.windows.create({ url: u, focused: true }), pageUrl("Second window — Google Scholar"));
  await sleep(1200);
  let log = since(await getLog(worker), t0);
  const count = (type, pred = () => true) => log.filter((e) => e.type === type && pred(e)).length;
  record("T1_tab_events", {
    tab_activated: count("tab_activated"),
    tab_updated_title: count("tab_updated", (e) => e.changed.includes("title")),
    window_focus: count("window_focus"),
    titles_seen: [...new Set(log.filter((e) => e.title).map((e) => e.title))],
    football_title_events: count("tab_updated", (e) => e.title?.startsWith("Top 10") && e.changed.includes("title")),
  });

  // T3: idle query
  record("T3_idle_query", await worker.evaluate(() => chrome.idle.queryState(15)));

  // T4a: alarm registration
  record("T4a_alarms", await worker.evaluate(() => chrome.alarms.getAll()));

  // T5: offscreen audio
  record("T5_offscreen_audio", await worker.evaluate(() => handlers.playSound({ volume: 0.3 })));

  // T6: notifications
  record("T6_notif_permission_level", await worker.evaluate(() => chrome.notifications.getPermissionLevel()));
  record("T6_notif_2_buttons", await worker.evaluate(() => handlers.notify({ buttons: 2 })));
  record("T6_notif_3_buttons", await worker.evaluate(() => handlers.notify({ buttons: 3 })));

  // T7a: overlay without host permission (http page and chrome:// page)
  const tabIdOf = async (url) => worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
  record("T7a_host_permission_granted", await worker.evaluate(() => handlers.hasHostPermission()));
  record("T7a_overlay_http_no_permission", await worker.evaluate((id) => handlers.injectOverlay({ tabId: id }), await tabIdOf(pA.url())));
  const pC = await browser.newPage(); await pC.goto("chrome://version");
  record("T7a_overlay_chrome_page", await worker.evaluate((id) => handlers.injectOverlay({ tabId: id }), await tabIdOf("chrome://version/")));

  // T8: sidePanel.open without a user gesture
  record("T8_sidepanel_open_no_gesture", await worker.evaluate(async () => {
    const w = await chrome.windows.getLastFocused();
    try { await chrome.sidePanel.open({ windowId: w.id }); return { ok: true }; } catch (e) { return { ok: false, e: String(e.message || e) }; }
  }));
  record("T8_panel_behavior", await worker.evaluate(() => chrome.sidePanel.getPanelBehavior()));

  // T4b: terminate the service worker, then check an alarm wakes it and state survives.
  // Observed from an extension page (not the worker target), so the observer
  // doesn't depend on puppeteer re-attaching to a restarted worker.
  const extId = new URL(target.url()).host;
  const reader = await browser.newPage();
  await reader.goto(`chrome-extension://${extId}/sidepanel.html`);
  const readLog = () => reader.evaluate(async () => (await chrome.storage.local.get("log")).log || []);
  const swStartsBefore = (await readLog()).filter((e) => e.type === "sw_start").length;
  const cdp = await browser.target().createCDPSession();
  record("T4b_terminate_sw", await cdp.send("Target.closeTarget", { targetId: target._targetId }).catch((e) => ({ error: String(e) })));
  const tKill = Date.now();
  await sleep(3000);
  const swTargetsAfterKill = browser.targets().filter((t) => t.type() === "service_worker").length;
  await sleep(40000); // > one 30 s alarm period, with no other events
  const after = await readLog();
  record("T4b_after_restart", {
    sw_targets_3s_after_kill: swTargetsAfterKill,
    sw_starts_before: swStartsBefore,
    sw_starts_after: after.filter((e) => e.type === "sw_start").length,
    sw_start_times_after_kill_ms: after.filter((e) => e.type === "sw_start" && e.t >= tKill).map((e) => e.t - tKill),
    alarms_after_kill: after.filter((e) => e.type === "alarm" && e.t >= tKill).map((e) => ({ dtMs: e.t - tKill, lateMs: Math.round(e.t - e.scheduled) })),
    log_entries_survived: after.length,
  });
  await browser.close();

  // ---------------- Run 2: host permission granted → overlay path ----------------
  const variant = makeVariant();
  ({ browser, target, worker } = await launch(variant));
  const p = await browser.newPage(); await p.goto(pageUrl("Top 10 Football Goals - YouTube"));
  await sleep(300);
  const pid = await worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, p.url());
  record("T7b_overlay_with_permission", await worker.evaluate((id) => handlers.injectOverlay({ tabId: id }), pid));
  await sleep(300);
  record("T7b_overlay_present", await p.evaluate(() => !!document.getElementById("fb-spike-overlay-host")));
  await p.keyboard.press("Escape"); await sleep(400);
  record("T7b_overlay_after_escape", await p.evaluate(() => !!document.getElementById("fb-spike-overlay-host")));
  log = await getLog(worker);
  record("T7b_overlay_events", log.filter((e) => e.type === "overlay_event").map((e) => e.ev));
  await browser.close();
} catch (e) {
  record("harness_error", String(e?.stack || e).slice(0, 400));
} finally {
  for (const b of puppeteerBrowsers) await b.close().catch(() => {});
  server.close();
  fs.writeFileSync(path.join(here, "results.json"), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
}
