/**
 * Diagnostic log (DATA_MODEL §8, ARCHITECTURE §10): `{at, code}` entries only,
 * capped (oldest dropped). Codes match DIAG_CODE; anything else becomes
 * E_INVALID_DIAG_CODE, so free text (which could hold a URL) is never kept.
 */
import type { DiagEntry } from "../types";
import { DIAG_CODE } from "./validate";

export const DIAG_CAP = 200;
export const INVALID_DIAG_CODE = "E_INVALID_DIAG_CODE";

export function normaliseDiagEntry(entry: DiagEntry): DiagEntry {
  const at = Number.isFinite(entry.at) && entry.at >= 0 ? entry.at : 0;
  const code = typeof entry.code === "string" && DIAG_CODE.test(entry.code) ? entry.code : INVALID_DIAG_CODE;
  return { at, code };
}

/** Returns a new log with `entry` appended and at most `cap` newest entries kept. */
export function appendDiag(log: readonly DiagEntry[], entry: DiagEntry, cap: number = DIAG_CAP): DiagEntry[] {
  const limit = Number.isInteger(cap) && cap > 0 ? cap : 0;
  if (limit === 0) return [];
  const next = [...log, normaliseDiagEntry(entry)];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
