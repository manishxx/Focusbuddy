// SD-1 / D-022: persistAcrossSessions only on Chrome ≥ 150, parsed from the user agent.
import { describe, expect, it } from "vitest";
import { chromeMajorVersion, supportsPersistAcrossSessions } from "../../../src/shell/adapters/chromeVersion";

const ua = (v: string) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;

describe("chromeMajorVersion", () => {
  it.each([
    [ua("157.0.8103.79"), 157],
    [ua("150.0.0.0"), 150],
    [ua("149.0.7000.1"), 149],
    [ua("120.0.6099.0"), 120],
    ["Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/157.0.8103.79 Safari/537.36", 157],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0", null],
    ["", null],
    ["Chrome/abc.1", null],
    ["XChrome/160.0", null],
  ])("%s → %s", (s, want) => {
    expect(chromeMajorVersion(s)).toBe(want);
  });
});

describe("supportsPersistAcrossSessions", () => {
  it("true from 150, false below and when unknown", () => {
    expect(supportsPersistAcrossSessions(ua("150.0.1.2"))).toBe(true);
    expect(supportsPersistAcrossSessions(ua("157.0.8103.79"))).toBe(true);
    expect(supportsPersistAcrossSessions(ua("149.9.9.9"))).toBe(false);
    expect(supportsPersistAcrossSessions("unknown")).toBe(false);
  });
});
