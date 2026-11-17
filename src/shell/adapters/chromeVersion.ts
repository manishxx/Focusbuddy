/**
 * Chrome version gate for `alarms.create({persistAcrossSessions})` (SD-1, D-022):
 * the option is passed only on Chrome ≥ 150. Pure, so it is unit-tested.
 */
export const PERSIST_ACROSS_SESSIONS_MIN_MAJOR = 150;

/** The Chrome major version from a user-agent string ("Chrome/N." or "HeadlessChrome/N."), or null. */
export function chromeMajorVersion(userAgent: string): number | null {
  const m = /(?:^|[\s(]|\bHeadless)Chrome\/(\d{1,4})\./.exec(userAgent);
  if (m === null) return null;
  const major = Number(m[1]);
  return Number.isInteger(major) ? major : null;
}

export function supportsPersistAcrossSessions(userAgent: string): boolean {
  const major = chromeMajorVersion(userAgent);
  return major !== null && major >= PERSIST_ACROSS_SESSIONS_MIN_MAJOR;
}
