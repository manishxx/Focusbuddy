// Day 05: verify ARCHITECTURE §13 V1–V8 and UX-3/UX-5 against real Chrome with a probe extension.
// Usage (repo root): node tests/e2e/platform/run-platform-facts.mjs [out.json]
// Env: CHROME_PATH (default: local Google Chrome). Headless, temporary profile.
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
const out = { chrome: null, at: new Date().toISOString(), results: {} };
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

const profile = mkdtempSync(path.join(tmpdir(), "fb-platform-"));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, enableExtensions: [probeDir] });
try {
  out.chrome = await browser.version();
  console.log("browser:", out.chrome);
  const swTarget = await browser.waitForTarget(t => t.type() === "service_worker" && t.url().endsWith("/sw.js"), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  let sw = await swTarget.worker();
  const call = (w, fn, ...args) => w.evaluate((fn, args) => self.probe[fn](...args), fn, args);

  // V1: storage.local access level. Control first: content script can read by default.
  await call(sw, "seed");
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
  R("V3", v3.startsWith("blocked") && !v3Left ? "YES (CSP blocks SW fetch)" : "NO (SW fetch not blocked by CSP)", { result: v3, requestReachedServer: v3Left });

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
} finally {
  await browser.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
const file = process.argv[2];
if (file) writeFileSync(file, JSON.stringify(out, null, 2));
