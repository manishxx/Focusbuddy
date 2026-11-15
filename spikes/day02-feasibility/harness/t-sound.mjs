// Headful sound diagnostic (owner listens). Throwaway profile.
// Group A: one shared AudioContext, 3 rising beeps 2 s apart.
// Group B: a new AudioContext per beep (original spike behaviour), same pattern.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
  enableExtensions: [path.resolve(here, "../extension")],
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "fb-spike-profile-")),
  defaultViewport: null,
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=700,500"],
});
try {
  const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"));
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${new URL(sw.url()).host}/sidepanel.html`);
  const beep = (mode, freq) => page.evaluate((m, f) => chrome.runtime.sendMessage({ cmd: "playSound", volume: 0.6, mode: m, freq: f }), mode, freq);
  await sleep(3000); // give the owner a moment after the window appears
  for (const group of [["A_reuse", "reuse"], ["B_new", "new"]]) {
    const res = [];
    for (const f of [440, 660, 880]) { res.push({ at: Date.now(), ...(await beep(group[1], f)) }); await sleep(2000); }
    out[group[0]] = res;
    await sleep(4000);
  }
} catch (e) {
  out.error = String(e?.stack || e).slice(0, 400);
} finally {
  await browser.close().catch(() => {});
  fs.writeFileSync(path.join(here, "results-sound.json"), JSON.stringify({ ranAt: new Date().toISOString(), out }, null, 2));
  console.log(JSON.stringify(out));
}
