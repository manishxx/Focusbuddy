/**
 * Time source for the pure core (ARCHITECTURE §3, ADR-0006).
 * Core code never calls Date.now() directly; it receives a Clock so tests can
 * control time deterministically.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export interface FakeClock extends Clock {
  /** Move time forward by `ms` (must be a finite, non-negative number). */
  advance(ms: number): number;
  /** Jump to an absolute time `t` (finite epoch milliseconds). */
  set(t: number): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${what} must be a finite number, got ${String(value)}`);
  }
}

export function createFakeClock(start = 0): FakeClock {
  assertFinite(start, "start");
  let current = start;
  return {
    now: () => current,
    advance(ms: number): number {
      assertFinite(ms, "ms");
      if (ms < 0) throw new RangeError(`ms must not be negative, got ${String(ms)}`);
      current += ms;
      return current;
    },
    set(t: number): number {
      assertFinite(t, "t");
      current = t;
      return current;
    },
  };
}
