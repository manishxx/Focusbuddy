/**
 * Typed access to the message bank (UX_GUIDELINES §5). The bank JSON is the
 * single source of truth for user-facing copy (ADR-0007).
 */
import bank from "./messages.json";

type Bank = typeof bank.messages;
export type MessageKey = keyof Bank;
export type MessageVars = Readonly<Record<string, string | number>>;

const messages: Readonly<Record<string, string | readonly string[]>> = bank.messages;

/**
 * Maximum length, in characters (Unicode code points) including the ellipsis,
 * of user-supplied placeholder values (UX_GUIDELINES §5 rule 10).
 */
export const PLACEHOLDER_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  task: 40,
  objective: 60,
  nextStep: 80,
  lastTitle: 60,
  words: 60,
});

export const ELLIPSIS = "…";

/** Truncate `text` to at most `limit` code points, ending with "…" if cut. */
export function truncate(text: string, limit: number): string {
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  return chars.slice(0, Math.max(0, limit - 1)).join("") + ELLIPSIS;
}

export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(messages, key);
}

/** Number of variants for a key (1 for a plain string). */
export function variantCount(key: MessageKey): number {
  const value = raw(key);
  return typeof value === "string" ? 1 : value.length;
}

function raw(key: string): string | readonly string[] {
  if (!hasMessage(key)) throw new Error(`Unknown message key: ${key}`);
  const value = messages[key];
  if (value === undefined) throw new Error(`Unknown message key: ${key}`);
  return value;
}

/**
 * Fill a bank string. Throws on an unknown key, an out-of-range variant or a
 * placeholder with no value. User placeholders are truncated per rule 10.
 */
export function format(key: MessageKey, vars: MessageVars = {}, variant = 0): string {
  const value = raw(key);
  let template: string | undefined;
  if (typeof value === "string") {
    if (variant !== 0) throw new RangeError(`Message ${key} has no variant ${String(variant)}`);
    template = value;
  } else {
    template = Number.isInteger(variant) ? value[variant] : undefined;
    if (template === undefined) {
      throw new RangeError(`Message ${key} has no variant ${String(variant)}`);
    }
  }
  return template.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new Error(`Message ${key} needs a value for {${name}}`);
    }
    const text = String(vars[name]);
    const limit = PLACEHOLDER_LIMITS[name];
    return limit === undefined ? text : truncate(text, limit);
  });
}
