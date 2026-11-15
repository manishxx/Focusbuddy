import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ALLOW_MARKER, MAX_BYTES, checkPath, decode, scanFiles, scanText } from "../../scripts/check-secrets.mjs";

// Fake secrets are assembled at run time so this file itself never matches.
const j = (...parts: string[]) => parts.join("");
const rulesFor = (text: string) => scanText("x", text).map((f) => f.rule);

describe("scanText detects", () => {
  it.each([
    ["private-key", j("-----BEGIN ", "RSA PRIVATE KEY-----")],
    ["private-key", j("-----BEGIN ", "OPENSSH PRIVATE KEY-----")],
    ["github-token", j("gh", "p_", "a".repeat(36))],
    ["github-fine-grained-pat", j("github_", "pat_", "A1".repeat(15))],
    ["anthropic-key", j("sk-", "ant-", "api03-", "Ab_-9".repeat(8))],
    ["sk-api-key", j("s", "k-", "Ab3".repeat(10))],
    ["sk-api-key", j("s", "k-", "proj-", "Ab3".repeat(10))],
    ["stripe-key", j("sk", "_live_", "a1".repeat(12))],
    ["stripe-key", j("rk", "_test_", "a1".repeat(12))],
    ["aws-access-key-id", j("AK", "IA", "ABCDEFGHIJKLMNOP")],
    ["aws-secret-access-key", j("aws_secret_access_key = ", "Ab1/".repeat(10))],
    ["slack-token", j("xo", "xb-", "1234567890-abc")],
    ["slack-webhook", j("https://hooks.", "slack.com/services/", "T0123ABCD/B0123ABCD/", "abcDEF123")],
    ["google-api-key", j("AI", "za", "C".repeat(35))],
    ["google-oauth-client-secret", j("GOC", "SPX-", "a".repeat(28))],
    ["npm-token", j("np", "m_", "a1B2".repeat(9))],
    ["jwt", j("ey", "JhbGciOiJIUzI1NiJ9", ".", "ey", "JzdWIiOiIxMjM0In0", ".", "abcdefghijk")],
    ["password-literal", j("pass", 'word: "hunter22"')],
    ["password-literal", j("PASS", "WORD='correct horse'")],
  ])("%s", (rule, text) => {
    expect(rulesFor(text)).toContain(rule);
  });
});

describe("scanText avoids false positives", () => {
  it.each([
    [".sk-skeleton-avatar-circle-large { }", ".sk-skeleton CSS class"],
    [j("AK", "IAIOSFODNN7EXAMPLE"), "AWS documented example key id"],
    ["aws commit 9f698171ed81b15d1823a05fc7211befd50c8ae0 secret", "git SHA next to 'secret'"],
    ['"integrity": "sha512-' + "Ab1/".repeat(22) + '=="', "lockfile integrity hash"],
    ["password: string;", "a type, not a literal"],
    ['password = ""', "empty password"],
    ["Tab titles and page addresses are never saved.", "ordinary prose"],
  ])("%s (%s)", (text) => {
    expect(rulesFor(text)).toEqual([]);
  });

  it(`skips lines with the ${ALLOW_MARKER} marker`, () => {
    expect(rulesFor(j("gh", "p_", "a".repeat(36), " // ", ALLOW_MARKER, ": documented example"))).toEqual([]);
    expect(scanText("x", j("ok\n", "gh", "p_", "a".repeat(36)))).toEqual([
      { path: "x", line: 2, rule: "github-token" },
    ]);
  });
});

describe("checkPath", () => {
  it.each([
    ".env",
    "a/.env.local",
    "id_rsa",
    "keys/id_ed25519.pub",
    "x.pem",
    "a/b.key",
    "c.p12",
    "d.pfx",
    "e.crx",
    "f.keystore",
    "g.jks",
  ])("flags %s", (p) => {
    expect(checkPath(p)).toHaveLength(1);
  });
  it.each([".env.example", "src/core/keys.ts", "docs/pem-notes.md", "monkey.txt"])("allows %s", (p) => {
    expect(checkPath(p)).toEqual([]);
  });
});

describe("decode and scanFiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "fb-secrets-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const token = j("gh", "p_", "b".repeat(36));

  it("decodes UTF-16 LE and BE files instead of skipping them", () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(token, "utf16le")]);
    const be = Buffer.from(le.subarray(2));
    be.swap16();
    expect(decode(le)).toBe(token);
    expect(decode(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(token);
    writeFileSync(join(dir, "u16.txt"), le);
    expect(scanFiles(["u16.txt"], dir).findings.map((f) => f.rule)).toEqual(["github-token"]);
  });

  it("skips binary files", () => {
    expect(decode(Buffer.from([0x89, 0x50, 0x00, 0x01]))).toBeNull();
  });

  it("fails on files over the size limit instead of skipping them", () => {
    writeFileSync(join(dir, "big.txt"), Buffer.alloc(MAX_BYTES + 1, 0x61));
    expect(scanFiles(["big.txt"], dir).findings).toEqual([
      { path: "big.txt", line: 0, rule: "file-too-large-to-scan" },
    ]);
  });
});
