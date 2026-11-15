// Day 05 smoke test: load the built extension (dist/) into local Chrome and check
// that the service worker starts and every page renders with no console errors,
// no CSP violations and no network requests leaving the extension (AC-10 rehearsal).
// Builds nothing itself: run `npm run build` first.
// Usage: node tests/e2e/smoke.mjs   Env: CHROME_PATH (default: local Google Chrome)
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  { file: "offscreen.html", h1: null }, // no UI; loaded only for console/CSP/network checks
];

const summary = {
  ok: false,
  chrome: null,
  extensionId: null,
  serviceWorker: null,
  pages: [],
  external: [],
  errors: [],
};
const fail = (msg) => summary.errors.push(msg);

if (!existsSync(join(dist, "manifest.json"))) {
  summary.errors.push("dist/manifest.json missing; run npm run build first");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(1);
}
if (!existsSync(CHROME)) {
  summary.errors.push(`Chrome not found at ${CHROME} (set CHROME_PATH)`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "fb-smoke-"));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    enableExtensions: [dist],
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  summary.chrome = await browser.version();

  const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/sw.js"), {
    timeout: 15_000,
  });
  const extId = new URL(swTarget.url()).host;
  const origin = `chrome-extension://${extId}/`;
  summary.extensionId = extId;
  summary.serviceWorker = { url: swTarget.url(), networkRequests: [] };

  // Watch the service worker's own network activity over CDP.
  const swSession = await swTarget.createCDPSession();
  await swSession.send("Network.enable");
  swSession.on("Network.requestWillBeSent", (e) => {
    summary.serviceWorker.networkRequests.push(e.request.url);
    if (!e.request.url.startsWith(origin)) summary.external.push({ from: "sw", url: e.request.url });
  });

  for (const { file, h1 } of PAGES) {
    const result = { page: file, h1: null, consoleErrors: [], pageErrors: [], cspViolations: [], requests: 0 };
    summary.pages.push(result);
    const page = await browser.newPage();
    try {
      await page.evaluateOnNewDocument(() => {
        const seen = [];
        Object.defineProperty(globalThis, "__fbCsp", { value: seen });
        document.addEventListener("securitypolicyviolation", (e) =>
          seen.push({ directive: e.violatedDirective, blocked: e.blockedURI, sample: e.sample }),
        );
      });
      page.on("console", (m) => {
        if (m.type() === "error") result.consoleErrors.push(m.text());
      });
      page.on("pageerror", (err) => result.pageErrors.push(String(err?.message ?? err)));
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        result.requests++;
        const url = req.url();
        if (url.startsWith(origin) || url.startsWith("data:")) return void req.continue();
        summary.external.push({ from: file, url });
        return void req.abort("blockedbyclient");
      });

      await page.goto(origin + file, { waitUntil: "load", timeout: 15_000 });
      if (h1) {
        await page.waitForSelector("h1", { timeout: 5_000 });
        result.h1 = await page.$eval("h1", (el) => el.textContent);
        if (result.h1 !== h1) fail(`${file}: h1 is ${JSON.stringify(result.h1)}, expected ${JSON.stringify(h1)}`);
      }
      // Let late errors and violation events arrive.
      await new Promise((r) => setTimeout(r, 300));
      result.cspViolations = await page.evaluate(() => globalThis.__fbCsp ?? []);

      if (file === "sidepanel.html") {
        // Effects of the SW's onInstalled handler, observed from a trusted page.
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
    if (result.consoleErrors.length) fail(`${file}: ${result.consoleErrors.length} console error(s)`);
    if (result.pageErrors.length) fail(`${file}: ${result.pageErrors.length} uncaught error(s)`);
    if (result.cspViolations.length) fail(`${file}: ${result.cspViolations.length} CSP violation(s)`);
  }
  // Positive control: the CSP detector must see a violation we cause on purpose
  // (an inline <style>, blocked by style-src 'self'; makes no network request).
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
    await new Promise((r) => setTimeout(r, 300));
    summary.cspDetectorControl = await control.evaluate(() => globalThis.__fbCsp);
    if (!summary.cspDetectorControl.length) fail("control: CSP detector saw no violation for an inline <style>");
  } finally {
    await control.close();
  }
  if (summary.external.length) fail(`${summary.external.length} request(s) left the extension`);
} catch (err) {
  fail(`harness: ${err?.message ?? err}`);
} finally {
  await browser?.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true });
}

summary.ok = summary.errors.length === 0;
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
