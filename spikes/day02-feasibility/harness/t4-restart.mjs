// T4 focused check: do 30 s alarms fire, does the SW get terminated/restarted,
// and does persisted state survive? Observed from an extension page.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, "../extension");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  enableExtensions: [EXT],
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "fb-spike-profile-")),
  args: ["--no-first-run", "--no-default-browser-check"],
});
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"));
  const extId = new URL(swTarget.url()).host;
  const reader = await browser.newPage();
  await reader.goto(`chrome-extension://${extId}/sidepanel.html`);
  const readLog = () => reader.evaluate(async () => (await chrome.storage.local.get("log")).log || []);
  const t0 = Date.now();
  const swCount = () => browser.targets().filter((t) => t.type() === "service_worker").length;

  // Phase 1: leave it alone for 75 s; count alarms and natural restarts.
  const samples = [];
  for (let i = 0; i < 15; i++) { await sleep(5000); samples.push(swCount()); }
  let log = await readLog();
  out.phase1_natural = {
    alarms: log.filter((e) => e.type === "alarm").map((e) => ({ atS: Math.round((e.t - t0) / 1000), lateMs: Math.round(e.t - e.scheduled) })),
    sw_starts: log.filter((e) => e.type === "sw_start").length,
    sw_target_count_every_5s: samples.join(""),
  };

  // Phase 2: force-stop all service workers via CDP, then wait for the alarm to wake it.
  const cdp = await reader.createCDPSession();
  await cdp.send("ServiceWorker.enable");
  const tStop = Date.now();
  out.phase2_stop = await cdp.send("ServiceWorker.stopAllWorkers").then(() => ({ ok: true }), (e) => ({ error: String(e) }));
  await sleep(1500);
  out.phase2_sw_targets_after_stop = swCount();
  await sleep(40000);
  log = await readLog();
  out.phase2_after = {
    sw_starts_total: log.filter((e) => e.type === "sw_start").length,
    sw_starts_after_stop_s: log.filter((e) => e.type === "sw_start" && e.t >= tStop).map((e) => Math.round((e.t - tStop) / 1000)),
    alarms_after_stop_s: log.filter((e) => e.type === "alarm" && e.t >= tStop).map((e) => Math.round((e.t - tStop) / 1000)),
    alarms_registered: await reader.evaluate(() => chrome.alarms.getAll()).then((a) => a.map((x) => x.name)),
    log_entries: log.length,
  };
} catch (e) {
  out.error = String(e?.stack || e).slice(0, 400);
} finally {
  await browser.close().catch(() => {});
  fs.writeFileSync(path.join(here, "results-t4.json"), JSON.stringify({ ranAt: new Date().toISOString(), out }, null, 2));
  console.log(JSON.stringify(out));
}
