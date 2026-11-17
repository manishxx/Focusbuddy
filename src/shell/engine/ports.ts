/**
 * Adapter interfaces the effect runner drives (ARCHITECTURE §3 shell/adapters).
 * Chrome implementations: src/shell/adapters/chrome.ts. Tests use in-memory fakes.
 * Every method may reject; the runner turns a rejection into a diag code.
 */
import type { UiSnapshot } from "../../core/session";

export type AlarmSpec = { when: number } | { periodMin: number };

export interface AlarmsPort {
  /** Creates or replaces the named alarm. */
  create(name: string, spec: AlarmSpec): Promise<void>;
  clear(name: string): Promise<void>;
}

export interface NotificationsPort {
  /** Creates or replaces the notification with this id. */
  create(id: string, content: { title: string; message: string }): Promise<void>;
  clear(id: string): Promise<void>;
  /** True if a notification with this id is currently shown (review F5). */
  exists(id: string): Promise<boolean>;
  /** Ids of every notification this extension currently shows (review F6). */
  listIds(): Promise<string[]>;
}

export interface ActionPort {
  setBadgeText(text: string): Promise<void>;
  setBadgeColors(background: string, text: string): Promise<void>;
  setTitle(title: string): Promise<void>;
}

export interface SnapshotPort {
  /** The stored snapshot, unvalidated (undefined when absent). */
  read(): Promise<unknown>;
  publish(snapshot: UiSnapshot): Promise<void>;
}

export type EffectPorts = {
  alarms: AlarmsPort;
  notifications: NotificationsPort;
  action: ActionPort;
  snapshot: SnapshotPort;
};
