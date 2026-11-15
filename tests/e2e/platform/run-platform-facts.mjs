// Day 05: verify ARCHITECTURE §13 V1–V8 and UX-3/UX-5 against real Chrome with a probe extension.
// Usage (repo root): node tests/e2e/platform/run-platform-facts.mjs [out.json]
// Env: CHROME_PATH (default: local Google Chrome). Headless, temporary profile.
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../../..");
const probeDir = path.join(here, "probe-ext");
const reqFrom = [path.join(repo, "package.json"), path.join(repo, "spikes/day02-feasibility/harness/package.json")];
let puppeteer;
for (const p of reqFrom) { try { puppeteer = createRequire(p)("puppeteer-core"); break; } catch { /* try next */ } }
if (!puppeteer) throw new Error("puppeteer-core not found");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = { chrome: null, mode: "headless", at: new Date().toISOString(), results: {} };
const R = (id, verdict, evidence) => { out.results[id] = { verdict, evidence }; console.log(`${id}: ${verdict} — ${JSON.stringify(evidence)}`); };

// Local test server: records every request so we can see whether a fetch actually left the extension.
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url.startsWith("/page")) {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>probe target</title><button id="page-btn">page button</button>
      <div id="cover" style="display:none;position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.01)"></div>`);
  } else { res.end("ok"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// Control extension: identical probe, but with connect-src * so the V3 result can be attributed to the CSP.
const ctrlDir = mkdtempSync(path.join(tmpdir(), "fb-probe-ctrl-"));
cpSync(probeDir, ctrlDir, { recursive: true });
const ctrlManifest = JSON.parse(readFileSync(path.join(ctrlDir, "manifest.json"), "utf8"));
ctrlManifest.name = "Focus Buddy platform probe CONTROL (test only)";
ctrlManifest.content_scripts = [];
ctrlManifest.content_security_policy.extension_pages = ctrlManifest.content_security_policy.extension_pages.replace("connect-src 'self'", "connect-src *");
writeFileSync(path.join(ctrlDir, "manifest.json"), JSON.stringify(ctrlManifest));

// Hardened variant: applies the access level at top level on every SW evaluation and registers onStartup,
// the pattern src/shell/sw.ts uses after Day 05 review F1. Its content script reports in data-v1h.
const hardDir = mkdtempSync(path.join(tmpdir(), "fb-probe-hard-"));
cpSync(probeDir, hardDir, { recursive: true });
const hardManifest = JSON.parse(readFileSync(path.join(hardDir, "manifest.json"), "utf8"));
hardManifest.name = "Focus Buddy platform probe HARDENED (test only)";
writeFileSync(path.join(hardDir, "manifest.json"), JSON.stringify(hardManifest));
writeFileSync(path.join(hardDir, "sw.js"), readFileSync(path.join(hardDir, "sw.js"), "utf8") +
  '\nchrome.runtime.onStartup.addListener(() => {});\nchrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });\n');
writeFileSync(path.join(hardDir, "cs.js"), readFileSync(path.join(hardDir, "cs.js"), "utf8").replaceAll("dataset.v1", "dataset.v1h"));

const profile = mkdtempSync(path.join(tmpdir(), "fb-platform-"));
const launch = () => puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, enableExtensions: [probeDir, ctrlDir, hardDir] });
let browser = await launch();
try {
  out.chrome = await browser.version();
  console.log("browser:", out.chrome);
  // Find both probe SWs and tell them apart by manifest name.
  const deadline = Date.now() + 15000;
  let swTargets = [];
  while (swTargets.length < 3 && Date.now() < deadline) {
    swTargets = browser.targets().filter(t => t.type() === "service_worker" && t.url().endsWith("/sw.js"));
    await new Promise(r => setTimeout(r, 200));
  }
  let swTarget, ctrlSw, hardSw;
  for (const t of swTargets) {
    const w = await t.worker();
    const name = await w.evaluate(() => chrome.runtime.getManifest().name);
    if (name.includes("CONTROL")) ctrlSw = w; else if (name.includes("HARDENED")) hardSw = w; else swTarget = t;
  }
  if (!swTarget || !ctrlSw) throw new Error("probe or control SW not found");
  const extId = new URL(swTarget.url()).host;
  let sw = await swTarget.worker();
  const call = (w, fn, ...args) => w.evaluate((fn, args) => self.probe[fn](...args), fn, args);

  // V1: storage.local access level. Control first: content script can read by default.
  await call(sw, "seed");
  await call(hardSw, "seed");
  const page = await browser.newPage();
  const readV1 = async () => {
    await page.goto(`${base}/page?${Date.now()}`, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.v1, { timeout: 5000 });
    return page.evaluate(() => document.documentElement.dataset.v1);
  };
  const before = await readV1();
  const setRes = await call(sw, "setAccessLevel");
  const after = await readV1();
  R("V1", setRes === "ok" && after.startsWith("error") && before.startsWith("read") ? "YES" : "NO/UNCLEAR",
    { contentScriptBefore: before, setAccessLevel: setRes, contentScriptAfter: after });

  // V2: sender seen by the offscreen document for a message sent from the SW.
  const v2 = await call(sw, "offscreenSender");
  R("V2", "OBSERVED", v2);

  // V3: does the extension_pages CSP (connect-src 'self') block the SW's fetch to the network?
  const n3 = hits.length;
  const v3 = await call(sw, "swFetch", `${base}/v3-sw`);
  const v3Left = hits.slice(n3).includes("/v3-sw");
  const n3c = hits.length;
  const v3c = await call(ctrlSw, "swFetch", `${base}/v3-ctrl`);
  const v3cLeft = hits.slice(n3c).includes("/v3-ctrl");
  R("V3", v3.startsWith("blocked") && !v3Left && v3cLeft ? "YES (CSP blocks SW fetch; control with connect-src * reaches the server)" : "NO/UNCLEAR",
    { result: v3, requestReachedServer: v3Left, control: { result: v3c, requestReachedServer: v3cLeft } });

  // V4: fetch of a bundled file from an extension page (and control: external fetch from a page).
  const ep = await browser.newPage();
  await ep.goto(`chrome-extension://${extId}/page.html`, { waitUntil: "load" });
  const n4 = hits.length;
  const v4 = await ep.evaluate(u => self.pageProbe(u), `${base}/v4-page`);
  const swSelf = await call(sw, "swFetch", `chrome-extension://${extId}/pack.json`);
  R("V4", v4.selfFetch.startsWith("allowed") ? "YES" : "NO",
    { pageSelfFetch: v4.selfFetch, swSelfFetch: swSelf, pageExternalFetch: v4.externalFetch, pageExternalReachedServer: hits.slice(n4).includes("/v4-page") });
  await ep.close();

  // V5: idle.setDetectionInterval has no getter, so persistence across SW restarts isn't observable.
  const v5 = await call(sw, "idleInterval");
  R("V5", "NOT OBSERVABLE (design already re-sets it on every SW start)", { setDetectionInterval: v5 });

  // UX-3: Chrome's install warnings for the real manifest (src/manifest.json once scaffolded).
  const mPath = path.join(repo, "dist/manifest.json"); // built manifest (src has no version; the build injects it)
  if (existsSync(mPath)) {
    const w = await call(sw, "warnings", readFileSync(mPath, "utf8"));
    R("UX-3", Array.isArray(w) ? "OBSERVED" : "ERROR", { chrome: out.chrome, warnings: w });
  } else R("UX-3", "SKIPPED (run npm run build first)", {});

  // V8 / UX-5: top-layer modal <dialog> in a closed shadow root from an isolated-world script.
  await page.goto(`${base}/page?v8`, { waitUntil: "load" });
  const tabs = await sw.evaluate(() => chrome.tabs.query({ url: "http://127.0.0.1/*" }));
  const target = tabs.find(t => t.url.includes("?v8"));
  const v8 = await call(sw, "inject", target.id);
  const r8 = v8.result;
  R("V8", r8.showModal === "ok" && r8.modal && r8.hitIsHost && !r8.pageButtonFocusable && !r8.coverWins ? "YES" : "PARTIAL/NO", r8);
  R("UX-5", r8.modal && !r8.pageButtonFocusable ? "YES (page inert while modal)" : "NO", { modal: r8.modal, pageButtonFocusable: r8.pageButtonFocusable });

  // V6: is storage.session cleared on extension reload?
  await call(sw, "storageSession", "set");
  const sessBefore = await call(sw, "storageSession", "get");
  // runtime.reload() leaves an --enable-extensions probe disabled (ERR_BLOCKED_BY_CLIENT on Day 05),
  // so the "reload" is done the way Chrome reloads an unpacked extension: load the same path again.
  let reloadVia = "browser.installExtension(same path)";
  try { await browser.installExtension(probeDir); } catch (e) { reloadVia = "installExtension failed: " + e.message; }
  await new Promise(r => setTimeout(r, 1500));
  const ep6 = await browser.newPage();
  let sessAfter;
  try {
    await ep6.goto(`chrome-extension://${extId}/page.html`, { waitUntil: "load" });
    sessAfter = await ep6.evaluate(() => chrome.storage.session.get("probeSession"));
  } catch (e) { sessAfter = { error: String(e.message || e) }; }
  await ep6.close();
  R("V6", sessAfter.error ? "INCONCLUSIVE" : Object.keys(sessAfter).length === 0 ? "YES (cleared on reload)" : "NO (kept across reload)", { reloadVia, before: sessBefore, afterReload: sessAfter });

  // V7 needs real focus changes from the side panel / notifications: headed manual check.
  R("V7", "NOT TESTED (needs headed Chrome and real focus; owner manual check)", {});
  // V1b: does the access level survive a full browser restart (same profile)? Day 05 review finding F1.
  await browser.close();
  browser = await launch();
  const p2 = await browser.newPage();
  await p2.goto(`${base}/page?restart`, { waitUntil: "load" });
  await p2.waitForFunction(() => document.documentElement.dataset.v1, { timeout: 5000 });
  const afterRestart = await p2.evaluate(() => document.documentElement.dataset.v1);
  await p2.waitForFunction(() => document.documentElement.dataset.v1h, { timeout: 5000 });
  const hardAfterRestart = await p2.evaluate(() => document.documentElement.dataset.v1h);
  R("V1-restart", afterRestart.startsWith("error") ? "PERSISTS across browser restart"
    : afterRestart.includes("local-value") ? "RESETS on browser restart (must re-apply on every SW start)" : "INCONCLUSIVE",
    { contentScriptAfterRestart: afterRestart });
  // Was the hardened SW even running yet? Wake it (any evaluate does), then read again.
  const hardTargets = browser.targets().filter(t => t.type() === "service_worker");
  const swRunningAtFirstRead = hardTargets.length;
  let hardWoken = null;
  for (const t of hardTargets) {
    const w = await t.worker();
    if ((await w.evaluate(() => chrome.runtime.getManifest().name)).includes("HARDENED")) hardWoken = w;
  }
  await p2.goto(`${base}/page?restart2`, { waitUntil: "load" });
  await p2.waitForFunction(() => document.documentElement.dataset.v1h, { timeout: 5000 });
  const hardAfterWake = await p2.evaluate(() => document.documentElement.dataset.v1h);
  out.results["V1-restart-detail"] = { swTargetsAfterRestart: swRunningAtFirstRead, hardenedSwFound: !!hardWoken, hardenedReadAfterWake: hardAfterWake };
  console.log("V1-restart-detail:", JSON.stringify(out.results["V1-restart-detail"]));
  R("V1-restart-hardened",
    hardAfterRestart.startsWith("error") ? "PROTECTED immediately after restart"
      : hardAfterWake.startsWith("error") ? "PROTECTED once the SW has run (a content script that runs before the SW's first evaluation after a restart can still read)"
      : "NOT PROTECTED",
    { firstReadAfterRestart: hardAfterRestart, readAfterSwRan: hardAfterWake });
} finally {
  await browser.close();
  rmSync(ctrlDir, { recursive: true, force: true });
  rmSync(hardDir, { recursive: true, force: true });
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
const file = process.argv[2];
if (file) writeFileSync(file, JSON.stringify(out, null, 2));
