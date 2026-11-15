// Types for scripts/check-manifest.mjs (used by tests/unit/check-manifest.test.ts).
export const REQUIRED_PERMISSIONS: string[];
export const OPTIONAL_HOST_PERMISSIONS: string[];
export const CSP: string;
export const MINIMUM_CHROME_VERSION: string;
export const ICONS: Record<string, string>;
export function checkManifest(
  manifest: Record<string, unknown>,
  options: { built: boolean; tooltip: string },
): string[];
export function diffExact(actual: unknown, expected: unknown, path: string): string[];
export function isLocalPath(path: unknown): boolean;
export function findDuplicateKeys(text: string): string[];
