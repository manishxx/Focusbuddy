// Types for scripts/check-secrets.mjs (used by tests/unit/check-secrets.test.ts).
export interface Finding {
  path: string;
  line: number;
  rule: string;
}
export const ALLOW_MARKER: string;
export const MAX_BYTES: number;
export const LARGE_FILE_ALLOWLIST: Set<string>;
export const RULES: ReadonlyArray<{ id: string; re: RegExp; lineAlso?: RegExp }>;
export function scanText(path: string, text: string): Finding[];
export function checkPath(path: string): Finding[];
export function decode(buf: Buffer): string | null;
export function scanFiles(paths: string[], base?: string): { findings: Finding[]; scanned: number };
export function gitFiles(): string[];
export function dirFiles(dir: string): string[];
