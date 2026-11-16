/**
 * Retention cut-off for the aggregate tier (DATA_MODEL §1, §8). Records whose
 * `endedAt` is strictly below the cut-off are pruned. retentionDays = 0 keeps
 * nothing: the cut-off is +Infinity, so every record is expired.
 */
export const DAY_MS = 86_400_000;
export const MAX_RETENTION_DAYS = 90;

export function cutoff(now: number, retentionDays: number): number {
  if (!Number.isFinite(now)) throw new RangeError("now must be finite");
  if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > MAX_RETENTION_DAYS) {
    throw new RangeError("retentionDays must be an integer 0–90");
  }
  if (retentionDays === 0) return Number.POSITIVE_INFINITY;
  return now - retentionDays * DAY_MS;
}

export function isExpired(endedAt: number, cut: number): boolean {
  return endedAt < cut;
}
