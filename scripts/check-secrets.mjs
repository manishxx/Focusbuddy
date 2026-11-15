// Secret scan (SECURITY §7, ADR-0007). Importable library plus a thin CLI.
//   node scripts/check-secrets.mjs             files git knows about (tracked plus
//                                              untracked-but-not-ignored)
//   node scripts/check-secrets.mjs --dir dist  every file under a directory (the build)
// Finds private keys, common token formats, password literals, secret-looking file
// names and .env files. Findings never echo the secret. A line containing the marker
// fb-allow-secret is skipped (for documented, fake examples only). Exit 1 on findings.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const ALLOW_MARKER = "fb-allow-secret";
export const MAX_BYTES = 2 * 1024 * 1024;
/** Files allowed to exceed MAX_BYTES (exact repo-relative paths). */
export const LARGE_FILE_ALLOWLIST = new Set([]);
/** Publicly documented example values that are not secrets. */
const DOCUMENTED_EXAMPLES = new Set(["AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"]);

export const RULES = [
  { id: "private-key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "github-fine-grained-pat", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  // sk- followed by >=20 alphanumerics then a word boundary: not ".sk-skeleton-avatar".
  { id: "sk-api-key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/ },
  { id: "stripe-key", re: /\b[rs]k_(?:test|live)_[0-9A-Za-z]{16,}\b/ },
  { id: "aws-access-key-id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    // 40-char base64 on a line that mentions aws/secret; needs mixed case so a git
    // SHA (lowercase hex) is not a match.
    id: "aws-secret-access-key",
    re: /(?<![A-Za-z0-9+/])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/=])/,
    lineAlso: /aws|secret/i,
  },
  { id: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { id: "slack-webhook", re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "google-oauth-client-secret", re: /\bGOCSPX-[A-Za-z0-9_-]{20,}/ },
  { id: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: "password-literal", re: /password\s*[:=]\s*["'][^"']{6,}["']/i },
];

const IGNORED_DIRS = /(^|\/)(node_modules|coverage|\.git)\//;
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_ALLOWED = /(^|\/)\.env\.example$/;
const SECRET_FILE =
  /(^|\/)(id_rsa[^/]*|id_dsa[^/]*|id_ecdsa[^/]*|id_ed25519[^/]*|[^/]+\.(pem|key|p12|pfx|crx|keystore|jks))$/i;

function stripExamples(line) {
  let out = line;
  for (const ex of DOCUMENTED_EXAMPLES) out = out.split(ex).join(" ");
  return out;
}

/** Scan one file's text; returns findings without echoing the secret itself. */
export function scanText(path, text) {
  const findings = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.includes(ALLOW_MARKER)) return;
    const line = stripExamples(raw);
    for (const rule of RULES)
      if (rule.re.test(line) && (!rule.lineAlso || rule.lineAlso.test(line)))
        findings.push({ path, line: i + 1, rule: rule.id });
  });
  return findings;
}

/** Findings from the file name alone. */
export function checkPath(path) {
  if (ENV_FILE.test(path) && !ENV_ALLOWED.test(path)) return [{ path, line: 0, rule: "env-file" }];
  if (SECRET_FILE.test(path)) return [{ path, line: 0, rule: "secret-file-name" }];
  return [];
}

/**
 * Decode a file for scanning. UTF-16 files (with a BOM) are decoded, not skipped.
 * Returns null for binary content (NUL bytes without a UTF-16 BOM).
 */
export function decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(2));
    le.swap16();
    return le.toString("utf16le");
  }
  if (buf.includes(0)) return null;
  return buf.toString("utf8");
}

/** Scan a list of paths (relative to `base`). Returns { findings, scanned }. */
export function scanFiles(paths, base = process.cwd()) {
  const findings = [];
  let scanned = 0;
  for (const path of paths) {
    findings.push(...checkPath(path));
    let stat;
    try {
      stat = statSync(join(base, path));
    } catch {
      continue; // deleted in the working tree
    }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_BYTES) {
      if (!LARGE_FILE_ALLOWLIST.has(path)) findings.push({ path, line: 0, rule: "file-too-large-to-scan" });
      continue;
    }
    const text = decode(readFileSync(join(base, path)));
    if (text === null) continue; // binary
    scanned++;
    findings.push(...scanText(path, text));
  }
  return { findings, scanned };
}

export function gitFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return [...new Set(out.split("\0").filter(Boolean))].filter((p) => !IGNORED_DIRS.test(p));
}

export function dirFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(dir, join(d.parentPath, d.name)).split("\\").join("/"))
    .sort();
}

function main(argv) {
  const at = argv.indexOf("--dir");
  const dir = at >= 0 ? argv[at + 1] : null;
  if (at >= 0 && !dir) {
    console.error("usage: check-secrets.mjs [--dir <directory>]");
    process.exit(2);
  }
  const { findings, scanned } = dir ? scanFiles(dirFiles(dir), dir) : scanFiles(gitFiles());
  const where = dir ? `${dir}/` : "";
  if (findings.length) {
    for (const f of findings) console.error(`${where}${f.path}:${f.line}: possible secret (${f.rule})`);
    console.error(`secret scan${dir ? ` (${dir})` : ""}: FAIL (${findings.length} finding(s) in ${scanned} files)`);
    process.exit(1);
  }
  console.log(`secret scan${dir ? ` (${dir})` : ""}: PASS (${scanned} text files scanned)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
