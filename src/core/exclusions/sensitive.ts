/**
 * Sensitive sites: the single source of truth (PARSER_SPEC §5.1, D-025).
 *
 * These hosts are never added to an allowlist. The parser recognises them only so
 * that naming one raises `site_sensitive_skipped` instead of silently allowing it,
 * and the Day 11 classifier (ARCHITECTURE §5.3 step 1, EXCLUDED) extends this module
 * rather than keeping a second list.
 *
 * Categories here: webmail, private messaging, banking and payment, health, dating,
 * job search and government ID. Exclusion always beats an allowlist, so a host that
 * appears here is dropped even when the user names it explicitly.
 *
 * Pure data: no clock, no `chrome`, no DOM.
 */

export type SensitiveSite = {
  /** Normalised host: lowercase, no "www.", validator-safe. */
  host: string;
  /** Spoken forms, lowercase. Only unambiguous ones (see sites.ts on name choice). */
  names: readonly string[];
};

const site = (host: string, names: readonly string[]): SensitiveSite => ({ host, names });

export const SENSITIVE_SITES: readonly SensitiveSite[] = Object.freeze([
  // webmail
  site("mail.google.com", ["google mail", "gmail"]),
  site("outlook.com", ["outlook", "hotmail", "outlook.com"]),
  site("mail.yahoo.com", ["yahoo mail"]),
  site("proton.me", ["proton mail", "protonmail", "proton.me"]),
  site("icloud.com", ["icloud mail", "icloud.com"]),
  // private messaging
  site("whatsapp.com", ["whatsapp", "whatsapp.com", "whats app"]),
  site("messenger.com", ["facebook messenger", "messenger.com", "messenger"]),
  site("web.telegram.org", ["telegram"]),
  // banking and payment
  site("paypal.com", ["paypal", "paypal.com"]),
  site("chase.com", ["chase bank", "chase.com"]),
  site("bankofamerica.com", ["bank of america", "bankofamerica.com"]),
  site("wellsfargo.com", ["wells fargo", "wellsfargo.com"]),
  site("hsbc.com", ["hsbc", "hsbc.com"]),
  site("barclays.co.uk", ["barclays"]),
  site("revolut.com", ["revolut", "revolut.com"]),
  site("monzo.com", ["monzo", "monzo.com"]),
  site("coinbase.com", ["coinbase", "coinbase.com"]),
  // health
  site("nhs.uk", ["nhs", "nhs.uk"]),
  site("webmd.com", ["webmd", "webmd.com"]),
  site("mychart.com", ["mychart", "my chart", "mychart.com"]),
  site("healthline.com", ["healthline", "healthline.com"]),
  // dating and adult
  site("tinder.com", ["tinder", "tinder.com"]),
  site("onlyfans.com", ["onlyfans", "onlyfans.com"]),
  // job search and government ID
  site("indeed.com", ["indeed.com"]),
  site("irs.gov", ["irs.gov", "irs"]),
  site("gov.uk", ["gov.uk"]),
]);

export const SENSITIVE_HOSTS: readonly string[] = Object.freeze(SENSITIVE_SITES.map((s) => s.host));

/** True for a sensitive host and for any subdomain of one. */
export function isSensitiveHost(host: string, hosts: readonly string[] = SENSITIVE_HOSTS): boolean {
  return hosts.some((s) => host === s || host.endsWith(`.${s}`));
}
