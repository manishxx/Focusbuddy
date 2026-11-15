// Headful real-Chrome checks for manual-checklist items that automation can reach:
// M10 overlay controls, M7 sound (owner listens), M12 idle, M14 browser restart.
// Uses a temporary profile; never the owner's own Chrome profile.
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const rec = (k, v) => { out[k] = v; console.log(`• ${k}: ${JSON.stringify(v)}`); };

// Variant with host permission at install so the overlay can be injected without a click.
const ext = fs.mkdtempSync(path.join(os.tmpdir(), "fb-spike-host-"));
fs.cpSync(path.resolve(here, "../extension"), ext, { recursive: true });
const m = JSON.parse(fs.readFileSync(path.join(ext, "manifest.json"), "utf8"));
m.host_permissions = ["<all_urls>"]; delete m.optional_host_permissions;
fs.writeFileSync(path.join(ext, "manifest.json"), JSON.stringify(m));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fb-spike-profile-"));

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>Top 10 Football Goals - YouTube</title><h1>Spike test page</h1>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const launch = () => puppeteer.launch({
  executablePath: CHROME, headless: false, enableExtensions: [ext], userDataDir: profile,
  defaultViewport: null, args: ["--no-first-run", "--no-default-browser-check", "--window-size=900,700"],
});

let browser;
try {
  browser = await launch();
  const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"));
  const extId = new URL(sw.url()).host;
  const reader = await browser.newPage();
  await reader.goto(`chrome-extension://${extId}/sidepanel.html`);
  const call = (cmd, extra = {}) => reader.evaluate((c, e) => chrome.runtime.sendMessage({ cmd: c, ...e }), cmd, extra);
  const readLog = () => reader.evaluate(async () => (await chrome.storage.local.get("log")).log || []);
  const page = await browser.newPage();
  await page.goto(url);
  await page.bringToFront();
  const tabId = await reader.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
  const present = () => page.evaluate(() => !!document.getElementById("fb-spike-overlay-host"));

  // M10: each control, pressed immediately (i.e. DURING the 5 s countdown).
  for (const [label, keys] of [["escape", ["Escape"]], ["back_button", ["Enter"]], ["continue_button", ["Tab", "Enter"]]]) {
    await call("injectOverlay", { tabId }); await sleep(400);
    const shown = await present();
    for (const k of keys) await page.keyboard.press(k);
    await sleep(400);
    rec(`M10_${label}`, { shown, closed_during_countdown: shown && !(await present()) });
  }
  rec("M10_overlay_events", (await readLog()).filter((e) => e.type === "overlay_event").map((e) => e.ev));

  // M7: three beeps, 1 s apart, so the owner can listen.
  const beeps = [];
  for (let i = 0; i < 3; i++) { beeps.push(await call("playSound", { volume: 0.5 })); await sleep(1000); }
  rec("M7_sound_results", beeps);

  // M12: observe idle transitions for 45 s (system-wide input; owner asked not to touch anything).
  const tIdle = Date.now();
  await sleep(45000);
  rec("M12_idle_events", (await readLog()).filter((e) => e.type === "idle_state" && e.t >= tIdle).map((e) => ({ atS: Math.round((e.t - tIdle) / 1000), state: e.state })));

  // M14: quit Chrome fully, wait > 1 alarm period, relaunch the same profile.
  const before = await readLog();
  rec("M14_before_quit", { entries: before.length, sw_starts: before.filter((e) => e.type === "sw_start").length,
    alarms: await reader.evaluate(() => chrome.alarms.getAll()).then((a) => a.map((x) => x.name)) });
  await browser.close();
  const tQuit = Date.now();
  await sleep(70000);
  browser = await launch();
  const sw2 = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"), { timeout: 20000 });
  const reader2 = await browser.newPage();
  await reader2.goto(`chrome-extension://${new URL(sw2.url()).host}/sidepanel.html`);
  await sleep(35000); // let at least one tick alarm fire after restart
  const after = await reader2.evaluate(async () => (await chrome.storage.local.get("log")).log || []);
  rec("M14_after_restart", {
    same_extension_id: new URL(sw2.url()).host === extId,
    entries: after.length,
    sw_starts: after.filter((e) => e.type === "sw_start").length,
    alarms_registered: await reader2.evaluate(() => chrome.alarms.getAll()).then((a) => a.map((x) => ({ name: x.name, persist: x.persistAcrossSessions }))),
    alarms_after_restart_s: after.filter((e) => e.type === "alarm" && e.t >= tQuit).map((e) => Math.round((e.t - tQuit) / 1000)),
    reinstalled_event: after.filter((e) => e.type === "installed").length,
  });
} catch (e) {
  rec("error", String(e?.stack || e).slice(0, 400));
} finally {
  await browser?.close().catch(() => {});
  server.close();
  fs.writeFileSync(path.join(here, "results-headful.json"), JSON.stringify({ ranAt: new Date().toISOString(), out }, null, 2));
}
