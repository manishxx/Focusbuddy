// Shared helpers for the session reducer tests.
import { expect } from "vitest";
import { reduceSession } from "../../../src/core/session/reducer";
import type { Effect, ReduceContext, ReduceResult, SessionInput } from "../../../src/core/session/types";
import { validateActiveState } from "../../../src/core/storage/validate";
import type { ActiveState } from "../../../src/core/types";

export const T0 = 1_800_000_000_000;
export const MIN = 60_000;

export function ctx(now: number, over: Partial<ReduceContext> = {}): ReduceContext {
  let n = 0;
  return { now, privateNotifications: false, defaultMode: "gentle", newId: () => `s${++n}`, ...over };
}

export const draft = (over: Record<string, unknown> = {}) => ({
  taskLabel: "Write report",
  objective: "Finish the draft",
  nextStep: "Outline section 2",
  allowedHosts: ["docs.example.com"],
  keywords: ["report"],
  plannedMin: 60,
  ...over,
});

export const cmd = (type: string, payload: unknown = {}): SessionInput =>
  ({ kind: "command", command: { type, payload } }) as SessionInput;

export function run(state: ActiveState | null, input: SessionInput, now: number, over: Partial<ReduceContext> = {}) {
  return reduceSession(state, input, ctx(now, over));
}

/** Asserts the state validates with the stored-data validator, and returns it. */
export function valid(r: ReduceResult): ActiveState {
  expect(r.error).toBeUndefined();
  expect(r.state).not.toBeNull();
  const v = validateActiveState(r.state);
  if (!v.ok) throw new Error(`invalid state: ${v.errors.join(", ")}`);
  return r.state as ActiveState;
}

export function started(now = T0, over: Record<string, unknown> = {}): ActiveState {
  return valid(run(null, cmd("session.start", { draft: draft(over) }), now));
}

export const types = (fx: Effect[]): string[] => fx.map((e) => e.type);
export const alarmsScheduled = (fx: Effect[]): string[] =>
  fx.flatMap((e) => (e.type === "ScheduleAlarm" ? [e.name] : []));
export const alarmsCleared = (fx: Effect[]): string[] => fx.flatMap((e) => (e.type === "ClearAlarm" ? [e.name] : []));
export const scheduled = (fx: Effect[], name: string) =>
  fx.find((e): e is Extract<Effect, { type: "ScheduleAlarm" }> => e.type === "ScheduleAlarm" && e.name === name);
export const notifications = (fx: Effect[]) =>
  fx.filter((e): e is Extract<Effect, { type: "ShowNotification" }> => e.type === "ShowNotification");
export const badge = (fx: Effect[]) => fx.find((e) => e.type === "SetBadge");
export const title = (fx: Effect[]) => fx.find((e) => e.type === "SetActionTitle");
