// Day 04 automated accessibility check (AC-30 rehearsal) for the static prototypes.
// Runs axe-core 4.14.0 (WCAG 2.0/2.1/2.2 A + AA tags) on every page, every panel state,
// in light and dark colour schemes, at 360 px and 320 px widths.
// Usage (from repo root): node prototypes/day04/axe-check.mjs [out.json]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve("prototypes/day04");
const req = createRequire(path.resolve("spikes/day02-feasibility/harness/package.json"));
const puppeteer = req("puppeteer-core");
const axeSrc = readFileSync(req.resolve("axe-core/axe.min.js"), "utf8");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const out = process.argv[2] || path.join(tmpdir(), "fb-axe-results.json");

const pages = readdirSync(root).filter(f => f.endsWith(".html"));
const profile = mkdtempSync(path.join(tmpdir(), "fb-axe-"));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ["--allow-file-access-from-files"] });
const results = [];
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("pageerror", e => consoleErrors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });

  async function run(url, label, scheme, width) {
    await page.setViewport({ width, height: 900 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => new Promise(r => setTimeout(r, 150)));
    await page.evaluate(axeSrc);
    const r = await page.evaluate(async tags => {
      const res = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"] });
      const hScroll = document.documentElement.scrollWidth > window.innerWidth + 1;
      return {
        violations: res.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map(n => n.target.join(" ")) })),
        incomplete: res.incomplete.map(v => ({ id: v.id, n: v.nodes.length })),
        hScroll,
      };
    }, TAGS);
    results.push({ label, scheme, width, ...r });
  }

  for (const f of pages) {
    const url = "file://" + path.join(root, f);
    await page.goto(url, { waitUntil: "load" });
    // Discover panel states from deep links if the page offers them.
    const states = f === "panel.html"
      ? await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-state], option[value]")]
          .map(e => e.dataset?.state || e.value).filter(Boolean))])
      : [""];
    for (const s of states) {
      for (const scheme of ["light", "dark"]) {
        for (const width of [360, 320]) {
          await run(url + (s ? "#" + s : ""), f + (s ? "#" + s : ""), scheme, width);
        }
      }
    }
  }
  const failing = results.filter(r => r.violations.length || r.hScroll);
  writeFileSync(out, JSON.stringify({ axe: "4.14.0", tags: TAGS, runs: results.length, consoleErrors, results }, null, 2));
  console.log(`runs: ${results.length}, runs with violations or horizontal scroll: ${failing.length}, console errors: ${consoleErrors.length}`);
  const byRule = {};
  for (const r of failing) {
    for (const v of r.violations) (byRule[v.id] ??= new Set()).add(`${r.label} [${r.scheme} ${r.width}]`);
    if (r.hScroll) (byRule["horizontal-scroll"] ??= new Set()).add(`${r.label} [${r.scheme} ${r.width}]`);
  }
  for (const [id, where] of Object.entries(byRule)) console.log(`- ${id}: ${where.size} runs, e.g. ${[...where].slice(0, 3).join("; ")}`);
  console.log("details:", out);
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
