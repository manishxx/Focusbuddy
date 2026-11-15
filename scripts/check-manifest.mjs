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

export const ICONS = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png",
};
const ANY_TEXT = Symbol("any non-empty string");

/** Exact expected shapes of the nested manifest objects (SECURITY §3, ARCH §8). */
export function expectedObjects(tooltip) {
  return {
    background: { service_worker: "sw.js", type: "module" },
    side_panel: { default_path: "sidepanel.html" },
    options_ui: { page: "options.html", open_in_tab: true },
    action: { default_title: tooltip, default_icon: ICONS },
    icons: ICONS,
    commands: { "mute-and-pause": { suggested_key: { default: "Alt+Shift+M" }, description: ANY_TEXT } },
  };
}

/** Deep exact comparison; returns human-readable differences. */
export function diffExact(actual, expected, path) {
  if (expected === ANY_TEXT)
    return typeof actual === "string" && actual.trim() ? [] : [`${path} must be a non-empty string`];
  if (expected === null || typeof expected !== "object")
    return actual === expected ? [] : [`${path} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  if (actual === null || typeof actual !== "object" || Array.isArray(actual) !== Array.isArray(expected))
    return [`${path} must be an object like ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  const out = [];
  for (const k of Object.keys(actual)) if (!(k in expected)) out.push(`${path}.${k} is not allowed`);
  for (const k of Object.keys(expected)) {
    if (!(k in actual)) out.push(`${path}.${k} is missing`);
    else out.push(...diffExact(actual[k], expected[k], `${path}.${k}`));
  }
  return out;
}

/** A local, relative extension path: no scheme, no leading slash or "//", no "..". */
export function isLocalPath(p) {
  return (
    typeof p === "string" &&
    p.length > 0 &&
    !/^[a-z][a-z0-9+.-]*:/i.test(p) &&
    !p.startsWith("/") &&
    !p.includes("\\") &&
    !p.split("/").some((seg) => seg === ".." || seg === "")
  );
}

/**
 * JSON.parse keeps the last of duplicate keys silently, so a second "permissions"
 * could hide from review. Scan the raw text and return every duplicate key path.
 */
export function findDuplicateKeys(text) {
  let i = 0;
  const dups = [];
  const ws = () => {
    while (/\s/.test(text[i] ?? "")) i++;
  };
  const str = () => {
    const start = i;
    i++;
    while (text[i] !== '"') {
      if (i >= text.length) throw new SyntaxError("unterminated string");
      i += text[i] === "\\" ? 2 : 1;
    }
    i++;
    return JSON.parse(text.slice(start, i));
  };
  const value = (path) => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const seen = new Set();
      ws();
      if (text[i] === "}") return void i++;
      for (;;) {
        ws();
        if (text[i] !== '"') throw new SyntaxError(`expected key at ${i}`);
        const key = str();
        if (seen.has(key)) dups.push(`${path}.${key}`);
        seen.add(key);
        ws();
        if (text[i++] !== ":") throw new SyntaxError(`expected : at ${i - 1}`);
        value(`${path}.${key}`);
        ws();
        const d = text[i++];
        if (d === "}") return;
        if (d !== ",") throw new SyntaxError(`expected , or } at ${i - 1}`);
      }
    } else if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") return void i++;
      for (let n = 0; ; n++) {
        value(`${path}[${n}]`);
        ws();
        const d = text[i++];
        if (d === "]") return;
        if (d !== ",") throw new SyntaxError(`expected , or ] at ${i - 1}`);
      }
    } else if (c === '"') str();
    else {
      const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
      if (!m) throw new SyntaxError(`unexpected token at ${i}`);
      i += m[0].length;
    }
  };
  value("$");
  ws();
  if (i < text.length) throw new SyntaxError(`trailing content at ${i}`);
  return dups;
}

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
  if (!sameList(m.permissions, REQUIRED_PERMISSIONS) || new Set(m.permissions).size !== m.permissions.length)
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
  for (const [key, want] of Object.entries(expectedObjects(tooltip))) p.push(...diffExact(m[key], want, key));
  for (const [where, icons] of [
    ["icons", m.icons],
    ["action.default_icon", m.action?.default_icon],
  ]) {
    for (const [size, path] of Object.entries(icons ?? {})) {
      if (!isLocalPath(path)) p.push(`${where}.${size} must be a local relative path, got ${JSON.stringify(path)}`);
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
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const dups = findDuplicateKeys(text);
      if (dups.length) {
        console.error(`${file}: FAIL\n  - duplicate keys: ${dups.join(", ")}`);
        failed = true;
        continue;
      }
      manifest = JSON.parse(text);
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
