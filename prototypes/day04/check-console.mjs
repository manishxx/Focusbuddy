// Day 04 prototype smoke check: opens every prototype page from file:// in headless Chrome
// (temporary profile), and reports console errors, page errors, non-file requests and
// horizontal overflow at 320px. Also visits every side-panel state via its #state-id.
// Usage: node prototypes/day04/check-console.mjs
// Uses the puppeteer-core already installed for the Day 02 harness (no new packages).
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../spikes/day02-feasibility/harness/package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGES = ["index.html", "onboarding.html", "panel.html", "intervention.html", "overlay.html", "notifications.html", "options.html"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fb-proto-"));
let browser;
let failures = 0;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ["--no-first-run", "--no-default-browser-check"] });

  async function visit(file, hash, width) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 800 });
    const errors = [];
    const remote = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) remote.push(r.url()); });
    const url = pathToFileURL(path.join(here, file)).href + (hash ? "#" + hash : "");
    try { await page.goto(url, { waitUntil: "load" }); }
    catch (e) {
      // Seen once: "Navigating frame was detached" on a fresh tab. Retry once and say so.
      console.log(`   retrying ${file}${hash ? "#" + hash : ""} after: ${e.message}`);
      await page.goto(url, { waitUntil: "load" });
    }
    await sleep(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const states = file === "panel.html" && !hash
      ? await page.evaluate(() => Array.from(document.querySelectorAll("#state-pick option")).map((o) => o.value))
      : null;
    await page.close();
    return { errors, remote, overflow, states };
  }

  for (const file of PAGES) {
    const r = await visit(file, "", 1280);
    const r320 = await visit(file, "", 320);
    const bad = r.errors.length + r.remote.length + r320.errors.length + (r320.overflow > 0 ? 1 : 0);
    failures += bad;
    console.log(`${file}: errors=${r.errors.length + r320.errors.length} remoteRequests=${r.remote.length} overflowAt320=${r320.overflow}px`);
    [...r.errors, ...r320.errors, ...r.remote].forEach((e) => console.log("   " + e));
    if (r.states) {
      let stateErrors = 0, overflowStates = [];
      for (const s of r.states) {
        const rs = await visit(file, s, 320);
        stateErrors += rs.errors.length;
        rs.errors.forEach((e) => console.log(`   #${s} ${e}`));
        if (rs.overflow > 0) overflowStates.push(`${s}(${rs.overflow}px)`);
      }
      failures += stateErrors + overflowStates.length;
      console.log(`panel.html states: ${r.states.length} visited at 320px, errors=${stateErrors}, overflow=${overflowStates.length ? overflowStates.join(", ") : "none"}`);
    }
  }

  // Overlay behaviour: real <dialog> opened with showModal (:modal), focus on Back to task,
  // Tab wraps inside, Escape closes and returns focus.
  {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(here, "overlay.html")).href, { waitUntil: "load" });
    await sleep(100);
    const sr = () => page.evaluate(() => {
      const r = document.getElementById("fb-overlay-host").shadowRoot;
      const d = r.querySelector("dialog");
      const a = r.activeElement;
      return { isDialog: !!d, open: !!(d && d.open), modal: !!(d && d.matches(":modal")), role: d && d.getAttribute("role"), focused: a ? a.textContent : null };
    });
    const first = await sr();
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");   // 4 visible buttons
    const wrapped = await sr();
    await page.keyboard.press("Escape");
    const afterEsc = await sr();
    await page.focus("#reopen");
    await page.keyboard.press("Enter");
    const reopened = await sr();
    await page.keyboard.press("Escape");
    const back = await page.evaluate(() => document.activeElement.id);
    console.log(`overlay: dialog=${first.isDialog} open=${first.open} :modal=${first.modal} role=${first.role} initialFocus="${first.focused}" afterTabx4="${wrapped.focused}" escapeCloses=${!afterEsc.open} reopenModal=${reopened.modal} reopenFocus="${reopened.focused}" focusReturnedTo=#${back}`);
    if (!first.isDialog || !first.modal || first.focused !== "Back to task" || wrapped.focused !== "Back to task" || afterEsc.open || !reopened.modal || back !== "reopen") failures++;
    await page.close();
  }

  // Panel: Escape closes More options and returns focus; End session… focuses Keep going;
  // check-in card hides the control row and the context line.
  {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(here, "panel.html")).href + "#on_task", { waitUntil: "load" });
    await sleep(100);
    await page.click('[aria-controls="more-menu"]');
    const opened = await page.evaluate(() => document.querySelector('[aria-controls="more-menu"]').getAttribute("aria-expanded"));
    await page.focus('#more-menu button');
    await page.keyboard.press("Escape");
    const esc = await page.evaluate(() => ({
      expanded: document.querySelector('[aria-controls="more-menu"]').getAttribute("aria-expanded"),
      hidden: document.getElementById("more-menu").hidden,
      focusIsButton: document.activeElement === document.querySelector('[aria-controls="more-menu"]'),
    }));
    await page.click('[aria-controls="more-menu"]');
    await page.click('#more-menu [data-go="end-confirm"]');
    const endFocus = await page.evaluate(() => document.activeElement.textContent);
    await page.goto(pathToFileURL(path.join(here, "panel.html")).href + "#drifted", { waitUntil: "load" });
    await sleep(100);
    const drift = await page.evaluate(() => ({ controlsHidden: document.getElementById("controls-full").hidden, nowHidden: document.getElementById("now-label").hidden, statusLive: document.getElementById("status-line").hasAttribute("aria-live") }));
    // In a drift card: More options -> End session... -> Keep going focused
    await page.click('[data-card="drift-l1"] [aria-controls="l1-more"]');
    await page.click('[data-card="drift-l1"] [data-act="stop"]');
    const endFocus2 = await page.evaluate(() => document.activeElement.textContent);
    console.log(`panel: moreOpened=${opened} escapeCollapses=${esc.expanded === "false" && esc.hidden} escapeFocusReturns=${esc.focusIsButton} endConfirmFocus="${endFocus}" endConfirmFromCardFocus="${endFocus2}" driftedControlsHidden=${drift.controlsHidden} driftedNowHidden=${drift.nowHidden} statusLineIsLive=${drift.statusLive}`);
    if (opened !== "true" || esc.expanded !== "false" || !esc.hidden || !esc.focusIsButton || endFocus !== "Keep going" || endFocus2 !== "Keep going" || !drift.controlsHidden || !drift.nowHidden || drift.statusLive) failures++;
    await page.close();
  }

  // Options delete dialog: Cancel focused by default, focus returns to opener.
  {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(here, "options.html")).href, { waitUntil: "load" });
    await page.click("#del-open");
    const f1 = await page.evaluate(() => document.activeElement.id);
    const resetChecked = await page.evaluate(() => document.getElementById("del-reset").checked);
    const modal = await page.evaluate(() => document.getElementById("del-dialog").matches(":modal"));
    await page.click("#del-reset");
    const warn = await page.evaluate(() => !document.getElementById("del-reset-warn").hidden);
    await page.keyboard.press("Escape");
    const f2 = await page.evaluate(() => document.activeElement.id);
    console.log(`options dialog: :modal=${modal} defaultFocus=#${f1} resetCheckedByDefault=${resetChecked} resetWarningWhenTicked=${warn} focusAfterEscape=#${f2}`);
    if (!modal || f1 !== "del-cancel" || resetChecked || !warn || f2 !== "del-open") failures++;
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(failures ? `FAIL (${failures} problems)` : "PASS");
process.exit(failures ? 1 : 0);
