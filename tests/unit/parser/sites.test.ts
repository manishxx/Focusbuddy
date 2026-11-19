// Site dictionary and site extraction (PARSER_SPEC §5, FR-T3).
import { describe, expect, it } from "vitest";
import {
  COMMON_TLDS,
  SENSITIVE_HOSTS,
  buildLookup,
  hasKnownTld,
  isIpv4,
  findSites,
  isSensitiveHost,
  mixedUseFor,
  normaliseHost,
  parseIntent,
  SENSITIVE_SITES,
  SITES,
} from "../../../src/core/parser";
import { isValidHost, LIMITS } from "../../../src/core/storage/validate";
import { ctx } from "./helpers";

const lookup = buildLookup(SITES);
const hostsIn = (text: string) => findSites(text, lookup, []).hosts;

describe("the bundled dictionary (§5)", () => {
  it("has at least 30 entries (FR-T3)", () => {
    expect(SITES.length).toBeGreaterThanOrEqual(30);
  });

  it("every host passes the Day 06 host validator and is normalised", () => {
    for (const site of SITES) {
      expect(isValidHost(site.host), site.host).toBe(true);
      expect(site.host.startsWith("www.")).toBe(false);
      expect(site.host).toBe(site.host.toLowerCase());
      expect(site.host.length).toBeLessThanOrEqual(LIMITS.hostLength);
    }
  });

  it("every spoken name is lowercase, non-empty and unique", () => {
    const seen = new Map<string, string>();
    for (const site of SITES) {
      expect(site.names.length).toBeGreaterThan(0);
      for (const name of site.names) {
        expect(name).toBe(name.toLowerCase().trim());
        expect(name.length).toBeGreaterThan(1);
        expect(seen.has(name), `${name} is claimed twice`).toBe(false);
        seen.set(name, site.host);
      }
    }
  });

  it("marks the mixed-use hosts §5 lists with a star", () => {
    const mixed = SITES.filter((s) => s.mixedUse).map((s) => s.host);
    for (const host of [
      "wikipedia.org",
      "github.com",
      "canva.com",
      "discord.com",
      "youtube.com",
      "reddit.com",
      "twitch.tv",
      "medium.com",
      "substack.com",
      "twitter.com",
      "linkedin.com",
      "instagram.com",
      "tiktok.com",
      "facebook.com",
      "netflix.com",
      "spotify.com",
    ]) {
      expect(mixed, host).toContain(host);
    }
    expect(SITES.find((s) => s.host === "scholar.google.com")?.mixedUse).toBe(false);
  });

  it("exposes the mixed-use flag per host for the Day 11 classifier", () => {
    expect(mixedUseFor(["youtube.com", "scholar.google.com", "unknown.example"])).toEqual({
      "youtube.com": true,
      "scholar.google.com": false,
      "unknown.example": false,
    });
    expect(mixedUseFor(["youtube.com"], [{ host: "youtube.com", names: ["yt"], mixedUse: false }])).toEqual({
      "youtube.com": false,
    });
  });

  it("orders the lookup longest name first", () => {
    const lengths = lookup.names.map((n) => n.name.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });
});

describe("matching (§5)", () => {
  it("matches the longer name first: google scholar beats google", () => {
    expect(hostsIn("study on google scholar and google docs")).toEqual(["scholar.google.com", "docs.google.com"]);
  });

  it("matches only on word boundaries", () => {
    expect(hostsIn("read the youtubers thread")).toEqual([]);
    expect(hostsIn("notional ideas about redditors")).toEqual([]);
    expect(hostsIn("watch youtube.")).toEqual(["youtube.com"]);
    expect(hostsIn("(youtube) and [reddit]")).toEqual(["youtube.com", "reddit.com"]);
  });

  it("keeps the order the user named the sites in, without duplicates", () => {
    expect(hostsIn("reddit, youtube, reddit again, and github")).toEqual(["reddit.com", "youtube.com", "github.com"]);
  });

  it("accepts bare domains and drops the path", () => {
    expect(hostsIn("read docs.example.com/x/y?z=1#f today")).toEqual(["docs.example.com"]);
    expect(hostsIn("read www.example.com")).toEqual(["example.com"]);
    expect(hostsIn("read EXAMPLE.com".toLowerCase())).toEqual(["example.com"]);
  });

  it("does not read an abbreviation or a decimal number as a domain", () => {
    const found = findSites("chapter 1.5, e.g. the first part, i.e. page 2.3", lookup, []);
    expect(found.hosts).toEqual([]);
    expect(found.unrecognised).toEqual([]);
  });

  it("reports a site-like word it cannot map, once", () => {
    const found = findSites("read münchen.de and köln.de", lookup, []);
    expect(found.hosts).toEqual([]);
    expect(found.unrecognised).toHaveLength(1);
  });

  it("never guesses an unknown proper noun", () => {
    expect(hostsIn("i'll use zork")).toEqual([]);
  });

  it("skips a sensitive site instead of allowing it (§5, exclusion wins)", () => {
    const found = findSites("check gmail and my chase bank balance on quizlet", lookup, []);
    expect(found.hosts).toEqual(["quizlet.com"]);
    expect(found.sensitive).toBe(true);
    for (const site of SENSITIVE_SITES) expect(found.hosts).not.toContain(site.host);
  });

  it("skips a sensitive bare domain and its subdomains", () => {
    const found = findSites("open mail.google.com and secure.chase.com", lookup, []);
    expect(found.hosts).toEqual([]);
    expect(found.sensitive).toBe(true);
    expect(isSensitiveHost("secure.chase.com", lookup.sensitiveHosts)).toBe(true);
    expect(isSensitiveHost("notchase.com", lookup.sensitiveHosts)).toBe(false);
  });

  it("ignores spans another step already took", () => {
    const text = "work until 5pm on youtube";
    expect(findSites(text, lookup, [{ start: 0, end: text.length }]).hosts).toEqual([]);
  });

  it("caps the allowlist at the validator limit, with a warning", () => {
    const names = SITES.flatMap((s) => s.names[0] ?? []);
    const { draft, warnings } = parseIntent(`study for 1 hour on ${names.join(", ")}`, ctx());
    expect(draft.allowedHosts).toHaveLength(LIMITS.allowedHosts);
    expect(new Set(draft.allowedHosts).size).toBe(LIMITS.allowedHosts);
    expect(warnings.map((w) => w.code)).toContain("sites_truncated");
  });

  it("§5.1: accepts a bare domain only with a known TLD", () => {
    for (const host of ["example.com", "docs.example.co.uk", "obsidian.md", "notion.so", "twitch.tv", "zoom.us"]) {
      expect(hasKnownTld(host), host).toBe(true);
    }
    for (const host of ["node.js", "wibble.zzz", "thing.notatld"]) expect(hasKnownTld(host), host).toBe(false);
    // IPv4 is matched on its own (review F9), not through the TLD list.
    expect(hasKnownTld("127.0.0.1")).toBe(false);
    expect(isIpv4("127.0.0.1")).toBe(true);
    expect(isIpv4("192.168.1.1")).toBe(true);
    expect(isIpv4("999.999.999.999")).toBe(false);
    expect(isIpv4("1.2.3")).toBe(false);
    expect(isIpv4("example.com")).toBe(false);
  });

  it("§5.1: an unknown TLD warns instead of inventing a host", () => {
    for (const text of ["read notes on wibble.zzz", "read the node.js docs"]) {
      const found = findSites(text, lookup, []);
      expect(found.hosts, text).toEqual([]);
      expect(found.unrecognised, text).toHaveLength(1);
    }
    expect(hostsIn("read docs.example.com")).toEqual(["docs.example.com"]);
  });

  it("§5.1: the TLD list covers every bundled host", () => {
    for (const host of [...SITES.map((s) => s.host), ...SENSITIVE_HOSTS]) {
      expect(COMMON_TLDS.has(host.slice(host.lastIndexOf(".") + 1)), host).toBe(true);
    }
  });

  it("§5.2: an ordinary English word is not a site name (review F5)", () => {
    for (const [text, word] of [
      ["work on medium difficulty problems", "medium"],
      ["zoom in on the diagram", "zoom"],
      ["a scholar of history", "scholar"],
      ["read the classroom notes", "classroom"],
      ["read wiki articles", "wiki"],
      ["khan was a general", "khan"],
      ["post an insta story", "insta"],
    ] as const) {
      expect(hostsIn(text), text).toEqual([]);
      expect(
        lookup.names.some((n) => n.name === word),
        word,
      ).toBe(false);
    }
    // The unambiguous forms still work.
    expect(hostsIn("read medium.com and google scholar and wikipedia")).toEqual([
      "medium.com",
      "scholar.google.com",
      "wikipedia.org",
    ]);
    expect(hostsIn("join the call on zoom.us with google classroom and khan academy")).toEqual([
      "zoom.us",
      "classroom.google.com",
      "khanacademy.org",
    ]);
  });

  it("§5.1: an email address is not a site, and a port is refused (review F8)", () => {
    const email = findSites("email a@b.com for help", lookup, []);
    expect(email.hosts).toEqual([]);
    expect(email.unrecognised).toEqual([]);
    const port = findSites("open example.com:8080", lookup, []);
    expect(port.hosts).toEqual([]);
    expect(port.unrecognised).toEqual(["example.com"]);
  });

  it("§5.1: an IPv4 literal is a host, out-of-range octets are not (review F9)", () => {
    expect(hostsIn("open 192.168.1.1 now")).toEqual(["192.168.1.1"]);
    const bad = findSites("open 999.999.999.999 now", lookup, []);
    expect(bad.hosts).toEqual([]);
    expect(bad.unrecognised).toEqual(["999.999.999.999"]);
  });

  it("§5.1: address-shaped text that is not a host is reported (D-027)", () => {
    for (const text of ["read notes on 1.2.3", "open [2001:db8::1]", "open 2001:db8::1", "open 1.2.3.4.5"]) {
      const found = findSites(text, lookup, []);
      expect(found.hosts, text).toEqual([]);
      expect(found.unrecognised.length, text).toBe(1);
    }
    // A decimal number is not address-shaped.
    expect(findSites("chapter 1.5 and section 2.3", lookup, []).unrecognised).toEqual([]);
  });

  it("reports where the sensitive names were, for the keyword sources (review F17)", () => {
    const found = findSites("study on mychart and quizlet", lookup, []);
    expect(found.hosts).toEqual(["quizlet.com"]);
    expect(found.sensitiveSpans).toHaveLength(1);
    const span = found.sensitiveSpans[0];
    expect("study on mychart and quizlet".slice(span?.start, span?.end)).toBe("mychart");
  });

  it("normaliseHost strips www and a trailing dot", () => {
    expect(normaliseHost(" WWW.Example.COM. ")).toBe("example.com");
    expect(normaliseHost("www.www.example.com")).toBe("example.com");
  });
});

describe("the sensitive list", () => {
  it("has valid, normalised hosts and no overlap with the allowlist dictionary", () => {
    const allowed = new Set(SITES.map((s) => s.host));
    for (const site of SENSITIVE_SITES) {
      expect(isValidHost(site.host), site.host).toBe(true);
      expect(allowed.has(site.host), site.host).toBe(false);
    }
  });
});

describe("the sensitive module is the single source (§5.1, D-025)", () => {
  it("lives in core/exclusions and is re-exported, not duplicated", async () => {
    const module = await import("../../../src/core/exclusions/sensitive");
    expect(module.SENSITIVE_SITES).toBe(SENSITIVE_SITES);
    expect(module.SENSITIVE_HOSTS).toEqual(SENSITIVE_SITES.map((s) => s.host));
    expect(module.isSensitiveHost("mail.google.com")).toBe(true);
    expect(module.isSensitiveHost("mail.google.com", [])).toBe(false);
  });

  it("holds a host for each category the spec names", () => {
    const hosts = SENSITIVE_SITES.map((s) => s.host);
    for (const host of ["mail.google.com", "chase.com", "nhs.uk", "whatsapp.com", "tinder.com", "irs.gov"]) {
      expect(hosts, host).toContain(host);
    }
    expect(SENSITIVE_SITES.length).toBeGreaterThanOrEqual(26);
  });
});
