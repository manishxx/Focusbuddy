// Manifest guard (ADR-0007): fails if the manifest drifts from SECURITY §3 and §6.
// Checks src/manifest.json and, when present, dist/manifest.json.
// Usage: node scripts/check-manifest.mjs [--dist-only]
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REQUIRED_PERMISSIONS = [
  "tabs",
  "idle",
  "alarms",
  "storage",
  "sidePanel",
  "offscreen",
  "notifications",
  "scripting",
  "contextMenus",
];
export const OPTIONAL_HOST_PERMISSIONS = ["http://*/*", "https://*/*"];
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const MINIMUM_CHROME_VERSION = "120";
const FORBIDDEN_KEYS = [
  "web_accessible_resources",
  "externally_connectable",
  "host_permissions",
  "content_scripts",
  "optional_permissions",
  "key",
  "update_url",
  "oauth2",
];
const ALLOWED_TOP_LEVEL = new Set([
  "manifest_version",
  "name",
  "version",
  "description",
  "minimum_chrome_version",
  "background",
  "side_panel",
  "options_ui",
  "action",
  "icons",
  "permissions",
  "optional_host_permissions",
  "commands",
  "content_security_policy",
]);

const sameList = (a, b) =>
  Array.isArray(a) && a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** Returns a list of problems (empty = valid). */
export function checkManifest(m, { built, tooltip }) {
  const p = [];
  if (m.manifest_version !== 3) p.push(`manifest_version must be 3, got ${m.manifest_version}`);
  if (m.name !== "Focus Buddy") p.push(`name must be "Focus Buddy", got ${JSON.stringify(m.name)}`);
  if (typeof m.description !== "string" || !m.description) p.push("description is missing");
  if (m.minimum_chrome_version !== MINIMUM_CHROME_VERSION)
    p.push(
      `minimum_chrome_version must be "${MINIMUM_CHROME_VERSION}", got ${JSON.stringify(m.minimum_chrome_version)}`,
    );
  if (built) {
    if (typeof m.version !== "string" || !/^\d+(\.\d+){0,3}$/.test(m.version))
      p.push(`version must be a Chrome version string, got ${JSON.stringify(m.version)}`);
  } else if ("version" in m) p.push("src/manifest.json must not set version (injected from package.json at build)");
  for (const k of Object.keys(m)) {
    if (FORBIDDEN_KEYS.includes(k)) p.push(`forbidden key present: ${k}`);
    else if (!ALLOWED_TOP_LEVEL.has(k))
      p.push(`unexpected top-level key: ${k} (update SECURITY.md and this guard first)`);
  }
  if (!sameList(m.permissions, REQUIRED_PERMISSIONS))
    p.push(`permissions must be exactly ${JSON.stringify(REQUIRED_PERMISSIONS)}, got ${JSON.stringify(m.permissions)}`);
  if (!sameList(m.optional_host_permissions, OPTIONAL_HOST_PERMISSIONS))
    p.push(
      `optional_host_permissions must be exactly ${JSON.stringify(OPTIONAL_HOST_PERMISSIONS)}, got ${JSON.stringify(m.optional_host_permissions)}`,
    );
  const csp = m.content_security_policy;
  if (!csp || typeof csp !== "object" || Object.keys(csp).join() !== "extension_pages")
    p.push("content_security_policy must contain only extension_pages");
  if (csp?.extension_pages !== CSP)
    p.push(
      `content_security_policy.extension_pages differs from SECURITY §6:\n  got:  ${csp?.extension_pages}\n  want: ${CSP}`,
    );
  const bg = m.background ?? {};
  if (bg.service_worker !== "sw.js" || bg.type !== "module" || Object.keys(bg).length !== 2)
    p.push(`background must be {"service_worker":"sw.js","type":"module"}, got ${JSON.stringify(m.background)}`);
  if (m.side_panel?.default_path !== "sidepanel.html") p.push("side_panel.default_path must be sidepanel.html");
  if (m.options_ui?.page !== "options.html" || m.options_ui?.open_in_tab !== true)
    p.push("options_ui must be {page: options.html, open_in_tab: true}");
  if (m.action?.default_title !== tooltip)
    p.push(`action.default_title must equal message bank tooltip.none (${JSON.stringify(tooltip)})`);
  if ("default_popup" in (m.action ?? {}))
    p.push("action.default_popup must not be set (the side panel opens on click)");
  const cmds = m.commands ?? {};
  const mute = cmds["mute-and-pause"];
  if (Object.keys(cmds).join() !== "mute-and-pause")
    p.push(`commands must be exactly mute-and-pause, got ${JSON.stringify(Object.keys(cmds))}`);
  if (mute?.suggested_key?.default !== "Alt+Shift+M")
    p.push("commands.mute-and-pause.suggested_key.default must be Alt+Shift+M");
  if (typeof mute?.description !== "string" || !mute.description)
    p.push("commands.mute-and-pause.description is missing");
  for (const [where, icons] of [
    ["icons", m.icons],
    ["action.default_icon", m.action?.default_icon],
  ]) {
    for (const size of ["16", "32", "48", "128"]) {
      const path = icons?.[size];
      if (typeof path !== "string" || /^[a-z]+:/i.test(path) || path.startsWith("//"))
        p.push(`${where}.${size} must be a local path, got ${JSON.stringify(path)}`);
      else if (built && !existsSync(new URL(`../dist/${path}`, import.meta.url)))
        p.push(`${where}.${size}: dist/${path} does not exist`);
    }
  }
  return p;
}

function main() {
  const distOnly = process.argv.includes("--dist-only");
  const tooltip = JSON.parse(readFileSync(new URL("../src/core/messages/messages.json", import.meta.url), "utf8"))
    .messages["tooltip.none"];
  const targets = [];
  if (!distOnly) targets.push(["src/manifest.json", false]);
  if (existsSync(new URL("../dist/manifest.json", import.meta.url))) targets.push(["dist/manifest.json", true]);
  else if (distOnly) {
    console.error("dist/manifest.json not found; run npm run build first");
    process.exit(1);
  }
  let failed = false;
  for (const [file, built] of targets) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    } catch (error) {
      console.error(`${file}: cannot read or parse (${error.message})`);
      failed = true;
      continue;
    }
    const problems = checkManifest(manifest, { built, tooltip });
    if (problems.length) {
      failed = true;
      console.error(`${file}: FAIL`);
      for (const msg of problems) console.error(`  - ${msg}`);
    } else console.log(`${file}: PASS`);
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
