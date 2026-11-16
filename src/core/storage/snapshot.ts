/**
 * Pure, read-once snapshot of untrusted input (review F1). Every exported
 * validator works on this copy, never on the caller's object, so a value can't
 * change between the check and the use (TOCTOU).
 *
 * - Copies only plain objects (prototype Object.prototype or null) and arrays, and
 *   only their own enumerable string-keyed DATA properties. Each property is read
 *   exactly once, through Object.getOwnPropertyDescriptor, so getters never run:
 *   an accessor property is rejected outright.
 * - Rejects functions, symbols and bigints as values, non-plain prototypes (Date,
 *   Map, class instances), cycles, arrays with extra non-index keys, and anything
 *   nested deeper than SNAPSHOT_MAX_DEPTH.
 * - Holes in arrays stay holes (validators reject them, review F2).
 * - Copied objects have a null prototype, so a `__proto__` key is plain data.
 * Symbol-keyed and non-enumerable properties are not copied.
 */

export const SNAPSHOT_MAX_DEPTH = 8;
export const SNAPSHOT_MAX_ARRAY = 10_000;

export class SnapshotError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SnapshotError";
  }
}

/** An empty object with a null prototype: `__proto__` and friends are plain keys on it. */
export function nullObject<T>(): Record<string, T> {
  const o: Record<string, T> = {};
  Object.setPrototypeOf(o, null);
  return o;
}

const INDEX = /^(?:0|[1-9][0-9]*)$/;

function dataValue(target: object, key: string): { present: false } | { present: true; value: unknown } {
  const desc = Object.getOwnPropertyDescriptor(target, key);
  if (desc === undefined || desc.enumerable !== true) return { present: false };
  if (desc.get !== undefined || desc.set !== undefined || !("value" in desc)) throw new SnapshotError("accessor");
  return { present: true, value: desc.value };
}

function copy(v: unknown, depth: number, ancestors: object[]): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v !== "object") throw new SnapshotError(`type_${typeof v}`);
  const o: object = v;
  if (depth >= SNAPSHOT_MAX_DEPTH) throw new SnapshotError("too_deep");
  if (ancestors.includes(o)) throw new SnapshotError("cycle");
  const next = [...ancestors, o];
  if (Array.isArray(o)) {
    const lengthDesc = Object.getOwnPropertyDescriptor(o, "length");
    const length: unknown = lengthDesc?.value;
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0) throw new SnapshotError("length");
    if (length > SNAPSHOT_MAX_ARRAY) throw new SnapshotError("too_long");
    const out: unknown[] = [];
    out.length = length;
    for (const key of Object.getOwnPropertyNames(o)) {
      if (key === "length") continue;
      if (!INDEX.test(key) || Number(key) >= length) throw new SnapshotError("array_extra_key");
      const d = dataValue(o, key);
      if (d.present) out[Number(key)] = copy(d.value, depth + 1, next);
    }
    return out;
  }
  const proto: unknown = Object.getPrototypeOf(o);
  if (proto !== Object.prototype && proto !== null) throw new SnapshotError("not_plain");
  const out = nullObject<unknown>();
  for (const key of Object.getOwnPropertyNames(o)) {
    const d = dataValue(o, key);
    if (d.present) out[key] = copy(d.value, depth + 1, next);
  }
  return out;
}

/** A read-once plain-data copy of `v`; throws SnapshotError if `v` isn't plain data. */
export function snapshotPlain(v: unknown): unknown {
  return copy(v, 0, []);
}

/** `{ok: true, value}` with the snapshot, or `{ok: false}` if `v` isn't plain data. */
export function trySnapshot(v: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: snapshotPlain(v) };
  } catch (error) {
    return { ok: false, reason: error instanceof SnapshotError ? error.reason : "unknown" };
  }
}
