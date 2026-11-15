// Day 05 smoke test: install the built extension (dist/) into local Chrome and check
// that the service worker starts, every page renders, and there are no console errors,
// no CSP violations and no network requests leaving the extension (AC-10 rehearsal).
//
// Network/console observation is attached BEFORE the extension is installed:
// Target.setAutoAttach with waitForDebuggerOnStart on the browser session pauses every
// new target (service worker, pages, offscreen document) until our listeners are on.
// The offscreen document is created the real way, by chrome.offscreen.createDocument
// evaluated in the service worker. Positive controls prove the detectors work.
//
// Builds nothing itself: run `npm run build` first.
// Usage: node tests/e2e/smoke.mjs   Env: CHROME_PATH (default: local Google Chrome)
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(root, "dist");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGES = [
  { file: "sidepanel.html", h1: "Focus Buddy" },
  { file: "options.html", h1: "Focus Buddy" },
  { file: "intervention.html", h1: "Focus Buddy" },
];
const CONTROL_PATH = "/__fb_network_control";

const summary = {
  ok: false,
  chrome: null,
  extensionId: null,
  observer: { attachedBeforeStart: [], targets: 0 },
  serviceWorker: null,
  offscreen: null,
  pages: [],
  external: [],
  controls: {},
  errors: [],
};
const fail = (msg) => summary.errors.push(msg);
const done = (code) => {
  summary.ok = code === 0 && summary.errors.length === 0;
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
};

if (!existsSync(join(dist, "manifest.json"))) {
  fail("dist/manifest.json missing; run npm run build first");
  done(1);
}
if (!existsSync(CHROME)) {
  fail(`Chrome not found at ${CHROME} (set CHROME_PATH)`);
  done(1);
}

// Local server for the positive network control only. Any hit means a request got out.
const serverHits = [];
const server = http.createServer((req, res) => {
  serverHits.push(req.url);
  res.end("control");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const controlBase = `http://127.0.0.1:${server.address().port}`;

// Per-target observations from our own CDP sessions.
let phase = "main"; // "main" | "controls"
const observed = new Map(); // sessionId -> record
const isExt = (url) => url.startsWith("chrome-extension://");

const profile = mkdtempSync(join(tmpdir(), "fb-smoke-"));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    enableExtensions: true, // installed below, after the observer is attached
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  summary.chrome = await browser.version();

  const cdp = await browser.target().createCDPSession();
  const connection = cdp.connection();
  const AUTO_ATTACH = {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: [{ type: "browser", exclude: true }, { type: "page", exclude: true }, {}],
  };
  // Under a tab target, attach to its page (and anything else except nested tabs).
  const TAB_CHILD_ATTACH = { ...AUTO_ATTACH, filter: [{ type: "tab", exclude: true }, {}] };
  const onAttached = async ({ sessionId, targetInfo, waitingForDebugger }) => {
    const session = connection.session(sessionId);
    if (!session) return;
    if (targetInfo.type === "tab") {
      // Pages live under tab targets: attach to their children the same way.
      session.on("Target.attachedToTarget", onAttached);
      await session.send("Target.setAutoAttach", TAB_CHILD_ATTACH);
      await session.send("Runtime.runIfWaitingForDebugger").catch(() => undefined);
      return;
    }
    if (waitingForDebugger && isExt(targetInfo.url)) summary.observer.attachedBeforeStart.push(targetInfo.url);
    const rec = {
      targetId: targetInfo.targetId,
      type: targetInfo.type,
      url: targetInfo.url,
      waitingForDebugger,
      requests: [],
      failed: [],
      consoleErrors: [],
      exceptions: [],
      logErrors: [],
      controlRequests: [],
      controlFailed: [],
      controlLogs: [],
    };
    observed.set(sessionId, rec);
    summary.observer.targets++;
    session.on("Network.requestWillBeSent", (e) => {
      const url = e.request.url;
      if (url.includes(CONTROL_PATH)) return void rec.controlRequests.push(url);
      rec.requests.push(url);
      if (!isExt(url) && !url.startsWith("data:") && isExt(rec.url))
        summary.external.push({ from: rec.url, url, phase });
    });
    session.on("Network.loadingFailed", (e) => {
      const entry = { blockedReason: e.blockedReason ?? null, error: e.errorText };
      (phase === "controls" ? rec.controlFailed : rec.failed).push(entry);
    });
    session.on("Runtime.consoleAPICalled", (e) => {
      if (e.type === "error" && phase === "main")
        rec.consoleErrors.push(e.args.map((a) => a.value ?? a.description).join(" "));
    });
    session.on("Runtime.exceptionThrown", (e) => {
      if (phase === "main") rec.exceptions.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text);
    });
    session.on("Log.entryAdded", ({ entry }) => {
      if (entry.level !== "error") return;
      if (phase === "controls") rec.controlLogs.push(`${entry.source}: ${entry.text}`);
      else rec.logErrors.push(`${entry.source}: ${entry.text}`);
    });
    try {
      await Promise.all([session.send("Network.enable"), session.send("Runtime.enable"), session.send("Log.enable")]);
    } catch {
      // Some target types don't support every domain; observation is best effort there.
    }
    await session.send("Runtime.runIfWaitingForDebugger").catch(() => undefined);
  };
  cdp.on("Target.attachedToTarget", onAttached);
  cdp.on("Target.targetInfoChanged", ({ targetInfo }) => {
    for (const rec of observed.values()) if (rec.targetId === targetInfo.targetId) rec.url = targetInfo.url;
  });
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  await cdp.send("Target.setAutoAttach", AUTO_ATTACH);

  const extId = await browser.installExtension(dist);
  const origin = `chrome-extension://${extId}/`;
  summary.extensionId = extId;

  const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url() === `${origin}sw.js`, {
    timeout: 15_000,
  });
  const sw = await swTarget.worker();
  summary.serviceWorker = { url: swTarget.url() };
  if (!summary.observer.attachedBeforeStart.includes(`${origin}sw.js`))
    fail("observer did not attach to the service worker before it started");

  // Offscreen document, created for real by the service worker.
  summary.offscreen = await sw.evaluate(async () => {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Focus Buddy smoke test",
    });
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    return { contexts: contexts.map((c) => c.documentUrl) };
  });
  if (!summary.offscreen.contexts.some((u) => u === `${origin}offscreen.html`))
    fail("offscreen document was not created");

  for (const { file, h1 } of PAGES) {
    const result = { page: file, h1: null, cspViolations: [] };
    summary.pages.push(result);
    const page = await browser.newPage();
    try {
      await page.evaluateOnNewDocument(() => {
        const seen = [];
        Object.defineProperty(globalThis, "__fbCsp", { value: seen });
        document.addEventListener("securitypolicyviolation", (e) =>
          seen.push({ directive: e.violatedDirective, blocked: e.blockedURI }),
        );
      });
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (url.startsWith(origin) || url.startsWith("data:")) return void req.continue();
        summary.external.push({ from: file, url, phase, blockedBy: "interception" });
        return void req.abort("blockedbyclient");
      });
      await page.goto(origin + file, { waitUntil: "load", timeout: 15_000 });
      await page.waitForSelector("h1", { timeout: 5_000 });
      result.h1 = await page.$eval("h1", (el) => el.textContent);
      if (result.h1 !== h1) fail(`${file}: h1 is ${JSON.stringify(result.h1)}, expected ${JSON.stringify(h1)}`);
      await new Promise((r) => setTimeout(r, 300));
      result.cspViolations = await page.evaluate(() => globalThis.__fbCsp ?? []);
      if (result.cspViolations.length) fail(`${file}: ${result.cspViolations.length} CSP violation(s)`);

      if (file === "sidepanel.html") {
        // Effects of the SW's top-level hardening, observed from a trusted page.
        summary.serviceWorker.panelBehavior = await page.evaluate(() => chrome.sidePanel.getPanelBehavior());
        summary.serviceWorker.startupErrors =
          (await page.evaluate(() => chrome.storage.session.get("diag.startupErrors")))["diag.startupErrors"] ?? [];
        if (summary.serviceWorker.panelBehavior?.openPanelOnActionClick !== true)
          fail("sidePanel behaviour openPanelOnActionClick is not true");
        if (summary.serviceWorker.startupErrors.length)
          fail(`SW start-up errors: ${summary.serviceWorker.startupErrors.join(", ")}`);
      }
    } catch (err) {
      fail(`${file}: ${err?.message ?? err}`);
    } finally {
      await page.close();
    }
  }
  await new Promise((r) => setTimeout(r, 300));

  // Per-target results of the main phase (extension targets only).
  summary.targets = [...observed.values()]
    .filter((r) => isExt(r.url))
    .map((r) => ({
      type: r.type,
      url: r.url.replace(origin, ""),
      attachedBeforeStart: r.waitingForDebugger,
      requests: r.requests.length,
      consoleErrors: r.consoleErrors,
      exceptions: r.exceptions,
      logErrors: r.logErrors,
    }));
  for (const t of summary.targets) {
    const n = t.consoleErrors.length + t.exceptions.length + t.logErrors.length;
    if (n) fail(`${t.url}: ${n} console error(s)/exception(s)`);
  }
  for (const want of ["sw.js", "offscreen.html", ...PAGES.map((p) => p.file)])
    if (!summary.targets.some((t) => t.url === want)) fail(`observer never saw ${want}`);
  if (summary.external.length) fail(`${summary.external.length} request(s) left the extension`);

  // ---- Positive controls (not counted above) ----
  phase = "controls";

  // 1. CSP detector: an inline <style> must be reported (style-src 'self').
  // 2. Network observer: a fetch from an extension page must be blocked (CSP
  //    connect-src 'self') AND observed as attempted; the local server must see nothing.
  const control = await browser.newPage();
  try {
    await control.evaluateOnNewDocument(() => {
      const seen = [];
      Object.defineProperty(globalThis, "__fbCsp", { value: seen });
      document.addEventListener("securitypolicyviolation", (e) => seen.push(e.violatedDirective));
    });
    await control.goto(origin + "intervention.html", { waitUntil: "load" });
    await control.evaluate(() => {
      const s = document.createElement("style");
      s.textContent = "h1{color:red}";
      document.head.append(s);
    });
    const fetchResult = await control.evaluate(async (url) => {
      try {
        await fetch(url);
        return "resolved";
      } catch (e) {
        return `rejected: ${e?.name}`;
      }
    }, `${controlBase}${CONTROL_PATH}?from=page`);
    await new Promise((r) => setTimeout(r, 500));
    const csp = await control.evaluate(() => globalThis.__fbCsp);
    const pageRec = [...observed.values()].filter((r) => r.type === "page" && isExt(r.url));
    const attemptsSeen = pageRec.some(
      (r) =>
        r.controlRequests.length > 0 ||
        r.controlFailed.some((f) => f.blockedReason === "csp") ||
        r.controlLogs.some((l) => l.includes(CONTROL_PATH)),
    );
    summary.controls.cspDetector = csp;
    summary.controls.pageFetch = {
      result: fetchResult,
      cspViolations: csp.filter((d) => d === "connect-src"),
      observedByCdp: attemptsSeen,
      serverHits: serverHits.filter((u) => u.includes("from=page")).length,
    };
    if (!csp.some((d) => d.startsWith("style-src"))) fail("control: CSP detector missed an inline <style>");
    const pf = summary.controls.pageFetch;
    if (pf.result === "resolved" || pf.serverHits > 0) fail("control: page fetch was NOT blocked");
    if (!pf.observedByCdp && pf.cspViolations.length === 0) fail("control: page fetch attempt was not observed");
  } finally {
    await control.close();
  }

  // 3. Network observer: allowed same-extension fetches (connect-src 'self') from a
  //    page and from the service worker must show up in Network.requestWillBeSent.
  const probeUrl = `${origin}manifest.json?__fb_observer_probe`;
  const obsPage = await browser.newPage();
  try {
    await obsPage.goto(origin + "options.html", { waitUntil: "load" });
    await obsPage.evaluate((u) => fetch(u).then((r) => r.status), probeUrl);
  } finally {
    await obsPage.close();
  }
  await sw.evaluate((u) => fetch(u).then((r) => r.status), probeUrl);
  await new Promise((r) => setTimeout(r, 300));
  const sawProbe = (type) =>
    [...observed.values()].some((r) => r.type === type && r.requests.some((u) => u === probeUrl));
  summary.controls.networkObserver = { page: sawProbe("page"), serviceWorker: sawProbe("service_worker") };
  if (!summary.controls.networkObserver.page) fail("control: network observer missed a page fetch");
  if (!summary.controls.networkObserver.serviceWorker) fail("control: network observer missed a SW fetch");

  // 4. Service-worker fetch: whether the CSP governs it is ARCH §13 V3 (architect's
  //    platform probe). Here we only require that the attempt is OBSERVED; the result
  //    is reported, not asserted.
  const swFetch = await sw.evaluate(async (url) => {
    try {
      const r = await fetch(url);
      return `resolved ${r.status}`;
    } catch (e) {
      return `rejected: ${e?.name}`;
    }
  }, `${controlBase}${CONTROL_PATH}?from=sw`);
  await new Promise((r) => setTimeout(r, 300));
  const swRec = [...observed.values()].find((r) => r.type === "service_worker" && r.url === `${origin}sw.js`);
  summary.controls.swFetch = {
    result: swFetch,
    observedByCdp:
      !!swRec &&
      (swRec.controlRequests.length > 0 ||
        swRec.controlFailed.length > 0 ||
        swRec.controlLogs.some((l) => l.includes(CONTROL_PATH))),
    logs: swRec?.controlLogs ?? [],
    serverHits: serverHits.filter((u) => u.includes("from=sw")).length,
  };
  if (!summary.controls.swFetch.observedByCdp) fail("control: service-worker fetch attempt was not observed");
} catch (err) {
  fail(`harness: ${err?.message ?? err}`);
} finally {
  await browser?.close().catch(() => undefined);
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

done(0);
