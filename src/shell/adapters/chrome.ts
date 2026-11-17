/**
 * Chrome implementations of the effect ports (src/shell/engine/ports.ts). Thin,
 * explicit wrappers: every chrome API is called directly (lint fb/chrome-access).
 * Not unit-tested (no logic beyond argument mapping); exercised by the e2e test.
 */
import type { ActionPort, AlarmsPort, EffectPorts, NotificationsPort } from "../engine/ports";
import { kvSnapshotPort } from "../engine/snapshotPort";
import { chromeSessionArea } from "../storage/kv";

/** `persistAcrossSessions` is passed (as true) only when the browser supports it (SD-1). */
export function chromeAlarms(persistAcrossSessions: boolean): AlarmsPort {
  const persist = persistAcrossSessions ? { persistAcrossSessions: true } : {};
  return {
    create: (name, spec) =>
      "when" in spec
        ? chrome.alarms.create(name, { when: spec.when, ...persist })
        : chrome.alarms.create(name, { delayInMinutes: spec.periodMin, periodInMinutes: spec.periodMin, ...persist }),
    clear: async (name) => {
      await chrome.alarms.clear(name);
    },
  };
}

export const chromeNotifications: NotificationsPort = {
  create: async (id, content) => {
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: content.title,
      message: content.message,
      priority: 0,
    });
  },
  clear: async (id) => {
    await chrome.notifications.clear(id);
  },
};

export const chromeAction: ActionPort = {
  setBadgeText: (text) => chrome.action.setBadgeText({ text }),
  setBadgeColors: async (background, text) => {
    await chrome.action.setBadgeBackgroundColor({ color: background });
    await chrome.action.setBadgeTextColor({ color: text });
  },
  setTitle: (title) => chrome.action.setTitle({ title }),
};

export function chromeEffectPorts(options: { persistAcrossSessions: boolean }): EffectPorts {
  return {
    alarms: chromeAlarms(options.persistAcrossSessions),
    notifications: chromeNotifications,
    action: chromeAction,
    snapshot: kvSnapshotPort(chromeSessionArea()),
  };
}
