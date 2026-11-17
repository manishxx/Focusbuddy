// In-memory effect ports and a storage harness for the engine tests.
import { createFakeClock, type FakeClock } from "../../../src/core/clock";
import type { UiSnapshot } from "../../../src/core/session/snapshot";
import type { SessionInput } from "../../../src/core/session/types";
import { createEngine, type EngineOptions, type EngineRepos } from "../../../src/shell/engine/engine";
import type { AlarmSpec, EffectPorts } from "../../../src/shell/engine/ports";
import { memoryKv, type MemoryKv } from "../../../src/shell/storage/memoryKv";
import { openStorage } from "../../../src/shell/storage/openStorage";
import { freshFactory, keyRange } from "../storage/fixtures";

export const T0 = 1_800_000_000_000;
export const MIN = 60_000;

export type FakePorts = EffectPorts & {
  log: string[];
  alarms: EffectPorts["alarms"] & { live: Map<string, AlarmSpec> };
  notifications: EffectPorts["notifications"] & {
    live: Map<string, { title: string; message: string }>;
    created: string[];
  };
  action: EffectPorts["action"] & { badge: string; color: string | null; title: string };
  snapshot: EffectPorts["snapshot"] & { published: UiSnapshot[]; stored: unknown };
  /** Makes every port call reject (a "crash" before effects complete). */
  broken: boolean;
};

export function fakePorts(log: string[] = []): FakePorts {
  const ports: FakePorts = {
    log,
    broken: false,
    alarms: {
      live: new Map(),
      create: (name, spec) => step(`alarm.create:${name}`, () => ports.alarms.live.set(name, spec)),
      clear: (name) => step(`alarm.clear:${name}`, () => ports.alarms.live.delete(name)),
    },
    notifications: {
      live: new Map(),
      created: [],
      create: (id, content) =>
        step(`notify.create:${id}`, () => {
          ports.notifications.created.push(id);
          ports.notifications.live.set(id, content);
        }),
      clear: (id) => step(`notify.clear:${id}`, () => ports.notifications.live.delete(id)),
    },
    action: {
      badge: "",
      color: null,
      title: "",
      setBadgeText: (t) => step(`badge:${t}`, () => (ports.action.badge = t)),
      setBadgeColors: (bg) => step(`badgeColor:${bg}`, () => (ports.action.color = bg)),
      setTitle: (t) => step("title", () => (ports.action.title = t)),
    },
    snapshot: {
      published: [],
      stored: undefined,
      read: () => Promise.resolve(ports.snapshot.stored),
      publish: (s) =>
        step("snapshot", () => {
          ports.snapshot.published.push(s);
          ports.snapshot.stored = s;
        }),
    },
  };
  function step(name: string, run: () => unknown): Promise<void> {
    log.push(name);
    if (ports.broken) return Promise.reject(new Error("crash"));
    run();
    return Promise.resolve();
  }
  return ports;
}

export type Harness = {
  local: MemoryKv;
  factory: IDBFactory;
  clock: FakeClock;
  repos: EngineRepos;
  close: () => void;
};

/** Opens real repositories over memoryKv + fake-indexeddb (as the SW does). */
export async function harness(
  local: MemoryKv = memoryKv(),
  factory: IDBFactory = freshFactory(),
  start = T0,
): Promise<Harness> {
  const clock = createFakeClock(start);
  const opened = await openStorage({
    local,
    session: memoryKv(),
    idbFactory: factory,
    now: () => clock.now(),
    idbKeyRange: keyRange,
  });
  return { local, factory, clock, repos: opened.repos, close: opened.close };
}

export function engineFor(h: Harness, ports: FakePorts, over: Partial<EngineOptions> = {}) {
  let n = 0;
  return createEngine({ repos: h.repos, ports, clock: h.clock, newId: () => `sess${++n}`, ...over });
}

export const startDraft = {
  draft: {
    taskLabel: "Write report",
    objective: "Finish the draft",
    allowedHosts: ["docs.example.com"],
    keywords: ["report"],
    plannedMin: 60,
  },
};

export const command = (type: string, payload: unknown = {}): SessionInput =>
  ({ kind: "command", command: { type, payload } }) as SessionInput;
