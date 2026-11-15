// Production build (ADR-0007): three Vite builds into dist/, then the manifest and icons.
//   1. pages: sidepanel, options, intervention (React) and offscreen
//   2. sw.js: one ES module service worker
//   3. overlay.js: one self-contained classic IIFE (for scripting.executeScript({files}))
// Usage: node scripts/build.mjs
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const PAGES = {
  sidepanel: "ui/sidepanel/index.html",
  options: "ui/options/index.html",
  intervention: "ui/intervention/index.html",
  offscreen: "offscreen/offscreen.html",
};

const common = {
  configFile: false,
  root: src,
  publicDir: false,
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
};

rmSync(dist, { recursive: true, force: true });

// 1. Pages. No modulepreload polyfill (it uses fetch and would be an inline helper),
// no inlined assets (every file is served from the extension itself).
await build({
  ...common,
  plugins: [react()],
  base: "/",
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: "chrome120",
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    sourcemap: false,
    rolldownOptions: {
      input: Object.fromEntries(Object.entries(PAGES).map(([name, file]) => [name, join(src, file)])),
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});

// Vite keeps the source folder layout for HTML; Chrome wants them at the root.
// Asset URLs are absolute ("/assets/..."), so moving the HTML does not break them.
for (const [name, file] of Object.entries(PAGES)) {
  renameSync(join(dist, file), join(dist, `${name}.html`));
}
rmSync(join(dist, "ui"), { recursive: true, force: true });
rmSync(join(dist, "offscreen"), { recursive: true, force: true });

// 2 and 3. Service worker (ES module) and overlay (classic IIFE), single files each.
for (const [entry, fileName, format] of [
  ["shell/sw.ts", "sw.js", "es"],
  ["content/overlay.ts", "overlay.js", "iife"],
]) {
  await build({
    ...common,
    build: {
      outDir: dist,
      emptyOutDir: false,
      target: "chrome120",
      sourcemap: false,
      copyPublicDir: false,
      // `name` is required by Vite for IIFE; overlay.ts exports nothing, so no global is
      // created (verified below).
      lib: { entry: join(src, entry), formats: [format], fileName: () => fileName, name: "FocusBuddyOverlay" },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
}

// Manifest: version from package.json.
const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
writeFileSync(join(dist, "manifest.json"), JSON.stringify({ ...manifest, version: pkg.version }, null, 2) + "\n");

// Icons: simple generated PNGs (rounded teal square with a white dot). No remote assets.
mkdirSync(join(dist, "icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(join(dist, "icons", `icon${size}.png`), iconPng(size));

const files = listFiles(dist);
verifyOutput(files);
console.log(`build: ${files.length} files in dist/`);
for (const f of files) console.log(`  ${f}`);

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)).split("\\").join("/"))
    .sort();
}

function verifyOutput(list) {
  const problems = [];
  for (const name of Object.keys(PAGES)) {
    const html = readFileSync(join(dist, `${name}.html`), "utf8");
    for (const tag of html.match(/<script\b[^>]*>/gi) ?? [])
      if (!/\bsrc=/.test(tag)) problems.push(`${name}.html: inline <script> ${tag}`);
    if (/<script\b[^>]*>[^<]+<\/script>/i.test(html)) problems.push(`${name}.html: script with inline body`);
    if (/\sstyle\s*=/i.test(html)) problems.push(`${name}.html: inline style= attribute`);
    if (/<style\b/i.test(html)) problems.push(`${name}.html: inline <style> element`);
    if (/\son[a-z]+\s*=/i.test(html)) problems.push(`${name}.html: inline event handler`);
    if (/(src|href)=["']?(https?:)?\/\//i.test(html)) problems.push(`${name}.html: remote URL`);
  }
  for (const f of list.filter((x) => x.endsWith(".js"))) {
    const js = readFileSync(join(dist, f), "utf8");
    if (/__vitePreload|modulepreload-polyfill/.test(js)) problems.push(`${f}: Vite preload helper present`);
  }
  const overlay = readFileSync(join(dist, "overlay.js"), "utf8");
  if (/^\s*(import|export)\b/m.test(overlay) || /\bimport\s*\(/.test(overlay))
    problems.push("overlay.js: contains import/export (must be a classic script)");
  if (/FocusBuddyOverlay/.test(overlay)) problems.push("overlay.js: defines a global (must set nothing on window)");
  const sw = readFileSync(join(dist, "sw.js"), "utf8");
  if (/\bimport\s*(\(|["'{*])/.test(sw)) problems.push("sw.js: imports another file (must be one module)");
  for (const required of ["sw.js", "overlay.js", "manifest.json", ...Object.keys(PAGES).map((p) => `${p}.html`)])
    if (!list.includes(required)) problems.push(`missing ${required}`);
  if (problems.length) {
    console.error("build verification FAILED:\n  " + problems.join("\n  "));
    process.exit(1);
  }
}

// ---- tiny PNG writer (RGBA, zlib) ----
function iconPng(size) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.22; // corner radius
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, Math.abs(x - c) - (c - r));
      const dy = Math.max(0, Math.abs(y - c) - (c - r));
      const inside = dx * dx + dy * dy <= r * r;
      const dot = (x - c) ** 2 + (y - c) ** 2 <= (size * 0.2) ** 2;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const [R, G, B, A] = !inside ? [0, 0, 0, 0] : dot ? [255, 255, 255, 255] : [15, 118, 110, 255];
      px[o] = R;
      px[o + 1] = G;
      px[o + 2] = B;
      px[o + 3] = A;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(px, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
