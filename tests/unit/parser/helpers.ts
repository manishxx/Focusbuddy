// Shared context builder for the parser tests.
import { SITES, type ParseCtx } from "../../../src/core/parser";
import type { Mode } from "../../../src/core/types";
import { FIXTURE_DEFAULT_MODE, FIXTURE_DEFAULT_PLANNED_MIN, FIXTURE_NOW, FIXTURE_TZ_OFFSET_MIN } from "./fixtures";

export function ctx(over: Partial<ParseCtx> & { mode?: Mode; plannedMin?: number } = {}): ParseCtx {
  return {
    now: over.now ?? FIXTURE_NOW,
    tzOffsetMin: over.tzOffsetMin ?? FIXTURE_TZ_OFFSET_MIN,
    defaults: over.defaults ?? {
      plannedMin: over.plannedMin ?? FIXTURE_DEFAULT_PLANNED_MIN,
      mode: over.mode ?? FIXTURE_DEFAULT_MODE,
    },
    sites: over.sites ?? SITES,
  };
}
