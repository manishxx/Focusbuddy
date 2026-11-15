import { describe, expect, it, vi } from "vitest";
import { createFakeClock, systemClock } from "../../src/core/clock";

describe("systemClock", () => {
  it("returns Date.now()", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    expect(systemClock.now()).toBe(1_700_000_000_000);
    spy.mockRestore();
  });
});

describe("createFakeClock", () => {
  it("defaults to 0 and starts at the given time", () => {
    expect(createFakeClock().now()).toBe(0);
    expect(createFakeClock(1000).now()).toBe(1000);
  });

  it("advances and returns the new time", () => {
    const clock = createFakeClock(1000);
    expect(clock.advance(500)).toBe(1500);
    expect(clock.advance(0)).toBe(1500);
    expect(clock.now()).toBe(1500);
  });

  it("sets an absolute time, including backwards", () => {
    const clock = createFakeClock(1000);
    expect(clock.set(5000)).toBe(5000);
    expect(clock.set(10)).toBe(10);
    expect(clock.now()).toBe(10);
  });

  it("rejects negative or non-finite advances", () => {
    const clock = createFakeClock(1000);
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(clock.now()).toBe(1000);
  });

  it("rejects non-finite start and set values", () => {
    expect(() => createFakeClock(Number.NaN)).toThrow(RangeError);
    const clock = createFakeClock(1);
    expect(() => clock.set(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
    expect(clock.now()).toBe(1);
  });

  it("keeps independent instances", () => {
    const a = createFakeClock(0);
    const b = createFakeClock(0);
    a.advance(10);
    expect(b.now()).toBe(0);
  });
});
