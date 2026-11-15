// Secret scan (SECURITY §7, ADR-0007). Scans files git knows about (tracked plus
// untracked-but-not-ignored, so it also works before the first commit) for private
// keys, common token formats and committed .env files. Exit 1 on any finding.
// Usage: node scripts/check-secrets.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RULES = [
  { id: "private-key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "github-fine-grained-pat", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: "sk-api-key", re: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/ },
  { id: "aws-access-key-id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "stripe-live-key", re: /\b[rs]k_live_[0-9A-Za-z]{16,}/ },
];

const IGNORED_DIRS = /(^|\/)(node_modules|dist|coverage|\.git)\//;
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const ENV_ALLOWED = /(^|\/)\.env\.example$/;
const MAX_BYTES = 2 * 1024 * 1024;

/** Scan one file's text; returns findings without echoing the secret itself. */
export function scanText(path, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) if (rule.re.test(line)) findings.push({ path, line: i + 1, rule: rule.id });
  });
  return findings;
}

export function checkPath(path) {
  if (ENV_FILE.test(path) && !ENV_ALLOWED.test(path)) return [{ path, line: 0, rule: "env-file" }];
  return [];
}

function listFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return [...new Set(out.split("\0").filter(Boolean))].filter((p) => !IGNORED_DIRS.test(p));
}

function main() {
  const findings = [];
  let scanned = 0;
  for (const path of listFiles()) {
    findings.push(...checkPath(path));
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue; // deleted in the working tree
    }
    if (!stat.isFile() || stat.size > MAX_BYTES) continue;
    const buf = readFileSync(path);
    if (buf.includes(0)) continue; // binary
    scanned++;
    findings.push(...scanText(path, buf.toString("utf8")));
  }
  if (findings.length) {
    for (const f of findings) console.error(`${f.path}:${f.line}: possible secret (${f.rule})`);
    console.error(`secret scan: FAIL (${findings.length} finding(s) in ${scanned} files)`);
    process.exit(1);
  }
  console.log(`secret scan: PASS (${scanned} text files scanned)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
