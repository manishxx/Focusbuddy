/**
 * Default preferences (DATA_MODEL §2). Values the data model leaves unstated
 * (sound, notificationsSeen, quietHours, ai, onboardingDone) are documented in the
 * Day 06 implementer report: sound on with the "chime" tone at half volume (only
 * Adaptive and Strict play sound), no test answer yet, no quiet hours, AI off.
 */
import type { Preferences } from "../types";

/** Deeply frozen at runtime; use defaultPreferences() for a mutable copy. */
export type DefaultPreferences = Readonly<Omit<Preferences, "userExclusions">> & {
  readonly userExclusions: readonly string[];
};

export const DEFAULT_PREFERENCES: DefaultPreferences = Object.freeze({
  schemaVersion: 1,
  defaultMode: "gentle",
  driftThresholdSec: 90,
  recoveryThresholdSec: 20,
  idleThresholdSec: 300,
  cooldownMin: Object.freeze({ gentle: 15, adaptive: 10, strict: 5 }),
  maxPerHour: 4,
  maxPerSession: 12,
  sound: Object.freeze({ enabled: true, tone: "chime", volume: 0.5 }),
  notificationsEnabled: true,
  notificationsSeen: null,
  shortcutMuteMin: 60,
  privateNotifications: false,
  overlay: Object.freeze({ enabled: false, countdownSec: 5, showTaskLabel: false }),
  quietHours: null,
  incognitoMonitoring: false,
  userExclusions: Object.freeze<string[]>([]),
  retentionDays: 30,
  ai: Object.freeze({ enabled: false, provider: "none" }),
  onboardingDone: false,
});

/** A fresh, mutable deep copy of the defaults. */
export function defaultPreferences(): Preferences {
  const d = DEFAULT_PREFERENCES;
  return {
    ...d,
    cooldownMin: { ...d.cooldownMin },
    sound: { ...d.sound },
    overlay: { ...d.overlay },
    userExclusions: [...d.userExclusions],
    ai: { ...d.ai },
    quietHours: d.quietHours === null ? null : { ...d.quietHours },
  };
}
