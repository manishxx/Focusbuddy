/**
 * Bundled site dictionary and site extraction (PARSER_SPEC §5, FR-T3).
 *
 * - 62 entries, each `{host, names, mixedUse}`; every host passes the Day 06
 *   host validator (lowercase, no "www.", no port or path).
 * - Names match only on a word boundary, and longer names are matched first, so
 *   "google scholar" wins over "google".
 * - §5.2: a spoken name is in the dictionary only if it is unambiguous in a study
 *   sentence. Ordinary English words ("medium", "zoom", "scholar", "classroom",
 *   "wiki", "khan", "insta", "linear", "teams", "meet", "indeed", "chase", "x") are
 *   not names; those sites stay reachable through an unambiguous form ("medium.com",
 *   "zoom.us", "google scholar", "wikipedia"). A wrong host is worse than a missing
 *   one, which the user can add (FR-T4).
 * - Sensitive sites are never allowed: they are recognised only so they can be
 *   dropped with a warning (exclusion beats an allowlist, ARCHITECTURE §5.3 step 1).
 *   The list lives in `core/exclusions/sensitive.ts`, the single source of truth that
 *   the Day 11 classifier extends (PARSER_SPEC §5.1, D-025).
 * - A bare domain is accepted only when its last label is a known TLD (§5.1), so
 *   "node.js" and "wibble.zzz" warn instead of becoming invented hosts.
 */
import { SENSITIVE_HOSTS, SENSITIVE_SITES, isSensitiveHost, type SensitiveSite } from "../exclusions/sensitive";
import { isValidHost, LIMITS } from "../storage/validate";
import { findWords, overlapsAny } from "./text";
import type { SiteDictionary, SiteEntry, Span } from "./types";

const entry = (host: string, names: readonly string[], mixedUse = false): SiteEntry => ({ host, names, mixedUse });

/** PARSER_SPEC §5 V1 dictionary. `mixedUse: true` = the classifier needs the title. */
export const SITES: SiteDictionary = Object.freeze([
  // ---- study and reference ----
  entry("scholar.google.com", ["google scholar", "scholar.google.com"]),
  entry("docs.google.com", ["google docs", "docs.google.com", "google doc", "gdocs"]),
  entry("drive.google.com", ["google drive", "drive.google.com", "gdrive"]),
  entry("classroom.google.com", ["google classroom", "classroom.google.com"]),
  entry("slides.google.com", ["google slides", "slides.google.com"]),
  entry("sheets.google.com", ["google sheets", "sheets.google.com"]),
  entry("wikipedia.org", ["wikipedia", "wikipedia.org"], true),
  entry("khanacademy.org", ["khan academy", "khanacademy.org"]),
  entry("coursera.org", ["coursera", "coursera.org"]),
  entry("edx.org", ["edx", "edx.org"]),
  entry("jstor.org", ["jstor", "jstor.org"]),
  entry("arxiv.org", ["arxiv", "arxiv.org"]),
  entry("pubmed.ncbi.nlm.nih.gov", ["pubmed", "pub med"]),
  entry("overleaf.com", ["overleaf", "overleaf.com"]),
  entry("notion.so", ["notion", "notion.so"]),
  entry("obsidian.md", ["obsidian", "obsidian.md"]),
  entry("zotero.org", ["zotero", "zotero.org"]),
  entry("quizlet.com", ["quizlet", "quizlet.com"]),
  entry("ankiweb.net", ["ankiweb", "ankiweb.net", "anki"]),
  entry("desmos.com", ["desmos", "desmos.com"]),
  entry("wolframalpha.com", ["wolfram alpha", "wolframalpha", "wolframalpha.com", "wolfram"]),
  // ---- developer ----
  entry("github.com", ["github", "github.com"], true),
  entry("gitlab.com", ["gitlab", "gitlab.com"]),
  entry("stackoverflow.com", ["stack overflow", "stackoverflow", "stackoverflow.com"]),
  entry("developer.mozilla.org", ["mozilla developer network", "mdn web docs", "mdn"]),
  entry("docs.python.org", ["python documentation", "python docs", "docs.python.org"]),
  entry("npmjs.com", ["npmjs", "npmjs.com", "npm"]),
  entry("codecademy.com", ["codecademy", "codecademy.com"]),
  entry("leetcode.com", ["leetcode", "leetcode.com", "leet code"]),
  entry("replit.com", ["replit", "replit.com", "repl.it"]),
  entry("huggingface.co", ["hugging face", "huggingface", "huggingface.co"]),
  entry("kaggle.com", ["kaggle", "kaggle.com"]),
  // ---- AI assistants ----
  entry("claude.ai", ["claude ai", "claude.ai", "claude"]),
  entry("chatgpt.com", ["chat gpt", "chatgpt", "chatgpt.com"]),
  entry("gemini.google.com", ["google gemini", "gemini.google.com", "gemini"]),
  entry("perplexity.ai", ["perplexity", "perplexity.ai"]),
  // ---- writing and productivity ----
  entry("grammarly.com", ["grammarly", "grammarly.com"]),
  entry("trello.com", ["trello", "trello.com"]),
  entry("asana.com", ["asana", "asana.com"]),
  entry("linear.app", ["linear app", "linear.app"]),
  entry("atlassian.net", ["jira", "atlassian"]),
  entry("confluence.atlassian.com", ["confluence"]),
  entry("figma.com", ["figma", "figma.com"]),
  entry("miro.com", ["miro", "miro.com"]),
  entry("canva.com", ["canva", "canva.com"], true),
  // ---- communication (allowed only if the user names it) ----
  entry("slack.com", ["slack", "slack.com"]),
  entry("zoom.us", ["zoom.us"]),
  entry("meet.google.com", ["google meet", "meet.google.com"]),
  entry("teams.microsoft.com", ["microsoft teams", "ms teams", "teams.microsoft.com"]),
  entry("discord.com", ["discord", "discord.com"], true),
  // ---- mixed-use media ----
  entry("youtube.com", ["youtube", "youtube.com", "you tube"], true),
  entry("reddit.com", ["reddit", "reddit.com"], true),
  entry("twitch.tv", ["twitch", "twitch.tv"], true),
  entry("medium.com", ["medium.com"], true),
  entry("substack.com", ["substack", "substack.com"], true),
  entry("twitter.com", ["twitter", "twitter.com", "x.com"], true),
  entry("linkedin.com", ["linkedin", "linkedin.com", "linked in"], true),
  entry("instagram.com", ["instagram", "instagram.com"], true),
  entry("tiktok.com", ["tiktok", "tiktok.com", "tik tok"], true),
  entry("facebook.com", ["facebook", "facebook.com"], true),
  entry("netflix.com", ["netflix", "netflix.com"], true),
  entry("spotify.com", ["spotify", "spotify.com"], true),
]);

export type SiteLookup = {
  /** Spoken names, longest first. */
  readonly names: readonly { name: string; host: string; sensitive: boolean }[];
  readonly byHost: ReadonlyMap<string, SiteEntry>;
  readonly sensitiveHosts: readonly string[];
};

/** Builds the lookup: longest names first, so "google scholar" beats "google". */
export function buildLookup(sites: SiteDictionary, sensitive: readonly SensitiveSite[] = SENSITIVE_SITES): SiteLookup {
  const names: { name: string; host: string; sensitive: boolean }[] = [];
  const byHost = new Map<string, SiteEntry>();
  for (const site of sensitive) {
    for (const name of site.names) names.push({ name, host: site.host, sensitive: true });
  }
  for (const site of sites) {
    byHost.set(site.host, site);
    for (const name of site.names) names.push({ name, host: site.host, sensitive: false });
  }
  // Longest first; ties by name so the order is stable and deterministic.
  names.sort((a, b) => b.name.length - a.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { names, byHost, sensitiveHosts: sensitive.map((s) => s.host) };
}

/** Normalises a host-like token: lowercase, no "www.", no trailing dot. */
export function normaliseHost(raw: string): string {
  let host = raw.toLowerCase().trim();
  while (host.endsWith(".")) host = host.slice(0, -1);
  while (host.startsWith("www.")) host = host.slice(4);
  return host;
}

/**
 * PARSER_SPEC §5.1: the TLDs a bare domain may use. The spec's list, plus every TLD
 * the bundled dictionaries use (so `obsidian.md`, `notion.so`, `twitch.tv` work), plus
 * IPv4, which the Day 06 host rules already check in full.
 */
const SPEC_TLDS = `com org net edu gov mil int io ai dev app co me info biz xyz md uk de fr ca au nz in jp
cn ru br mx nl se no dk fi pl es it ch at be ie pt gr il za kr tw hk sg tr ua cz ro hu eu us`.split(/\s+/);

export const COMMON_TLDS: ReadonlySet<string> = new Set([
  ...SPEC_TLDS,
  ...[...SITES.map((s) => s.host), ...SENSITIVE_HOSTS].map((h) => h.slice(h.lastIndexOf(".") + 1)),
]);

/**
 * §5.1: a bare domain is usable only with a known TLD. An IPv4 literal does not go
 * through here: `findSites` matches it on its own and checks it with `isValidHost`,
 * which enforces the four octets 0–255 (review F9).
 */
export function hasKnownTld(host: string): boolean {
  return COMMON_TLDS.has(host.slice(host.lastIndexOf(".") + 1));
}

/** A dotted-quad that passes the Day 06 host rules (octets 0–255). */
export function isIpv4(host: string): boolean {
  return /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/.test(host) && isValidHost(host);
}

/**
 * A domain-shaped word: at least two labels and an alphabetic top-level label of
 * two or more characters, so "e.g" and "i.e" are not read as hosts. An optional
 * path, query or fragment is dropped.
 */
const BARE_DOMAIN = /(?<![\p{L}\p{N}_@.-])((?:[a-z0-9][a-z0-9-]*\.)+[a-z][a-z0-9-]+)(:[0-9]{1,5})?(?:\/[^\s]*)?/gu;
/** Anything site-shaped that is not a host, for `site_unrecognised`. */
const SITE_SHAPED =
  /(?<![\p{L}\p{N}_@.-])((?:[\p{L}0-9][\p{L}0-9-]*\.)+[\p{L}][\p{L}0-9-]{1,23})(:[0-9]{1,5})?(?:\/[^\s]*)?/gu;
/** A dotted-quad, checked against the Day 06 host rules (octets 0–255) (§5.1, review F9). */
const IPV4_SHAPED = /(?<![\p{L}\p{N}_@.-])([0-9]{1,3}(?:\.[0-9]{1,3}){3})(:[0-9]{1,5})?(?:\/[^\s]*)?/gu;
/** An email address: its domain is not a site the user named (review F8). */
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+/gu;

export type SiteFindings = {
  hosts: string[];
  spans: Span[];
  /** A sensitive site was named and skipped. */
  sensitive: boolean;
  /** Where the sensitive names were, so they can be kept out of the keywords (review F17). */
  sensitiveSpans: Span[];
  /** A site-like word could not be mapped to a host. */
  unrecognised: string[];
  /** The mixed-use flag per matched host (for the UI and the Day 11 classifier). */
  mixedUse: Record<string, boolean>;
};

/**
 * PARSER_SPEC §5: dictionary names first (longest first, word boundaries), then
 * bare domains in the leftover text. Duplicates are removed, order is first-seen.
 */
export function findSites(lower: string, lookup: SiteLookup, consumed: readonly Span[]): SiteFindings {
  const spans: Span[] = [];
  const at: { host: string; start: number }[] = [];
  const mixedUse: Record<string, boolean> = {};
  const unrecognised: string[] = [];
  const sensitiveSpans: Span[] = [];
  let sensitive = false;
  const taken = (span: Span): boolean => overlapsAny(span, consumed) || overlapsAny(span, spans);
  const note = (value: string): void => {
    if (unrecognised.length === 0) unrecognised.push(value);
  };
  const add = (host: string, start: number): void => {
    at.push({ host, start });
    mixedUse[host] = lookup.byHost.get(host)?.mixedUse ?? false;
  };

  for (const { name, host, sensitive: isSensitive } of lookup.names) {
    for (const span of findWords(lower, name)) {
      if (taken(span)) continue;
      spans.push(span);
      if (isSensitive) {
        sensitive = true;
        sensitiveSpans.push(span);
      } else add(host, span.start);
    }
  }

  // An email address is not a site (review F8): its span is taken so the domain
  // inside it cannot be read as a host, and the address stays out of the label.
  for (const match of lower.matchAll(EMAIL)) {
    const span = { start: match.index, end: match.index + match[0].length };
    if (!taken(span)) spans.push(span);
  }

  // IPv4 literals (review F9): accepted as hosts, with the octet check.
  for (const match of lower.matchAll(IPV4_SHAPED)) {
    const span = { start: match.index, end: match.index + match[0].length };
    if (taken(span)) continue;
    spans.push(span);
    const host = normaliseHost(match[1] ?? "");
    if (match[2] !== undefined)
      note(host); // a :port is not a host (review F8)
    else if (isIpv4(host)) add(host, span.start);
    else note(host);
  }

  // Bare domains in what is left.
  for (const match of lower.matchAll(BARE_DOMAIN)) {
    const whole = match[0];
    const start = match.index;
    const span = { start, end: start + whole.length };
    if (taken(span)) continue;
    const host = normaliseHost(match[1] ?? "");
    spans.push(span);
    if (isSensitiveHost(host, lookup.sensitiveHosts)) {
      sensitive = true;
      sensitiveSpans.push(span);
      continue;
    }
    // A :port suffix is rejected, not trimmed (review F8).
    if (match[2] !== undefined) note(host);
    else if (isValidHost(host) && host.length <= LIMITS.hostLength && hasKnownTld(host)) add(host, span.start);
    else note(host);
  }

  // Site-shaped words that are not valid hosts (an IDN in Unicode form, "a.b.",
  // an unknown top-level label): reported once, never allowed.
  for (const match of lower.matchAll(SITE_SHAPED)) {
    const start = match.index;
    const span = { start, end: start + match[0].length };
    if (taken(span)) continue;
    spans.push(span);
    note(normaliseHost(match[1] ?? ""));
  }

  // Hosts in the order the user named them, de-duplicated.
  const hosts: string[] = [];
  for (const { host } of [...at].sort((a, b) => a.start - b.start)) if (!hosts.includes(host)) hosts.push(host);
  return { hosts, spans, sensitive, sensitiveSpans, unrecognised, mixedUse };
}
