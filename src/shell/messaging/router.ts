/**
 * Message router (API_CONTRACTS §1–§3). Every runtime message goes through:
 *   1. sender validation (§2): `sender.id === runtime.id` and `sender.url`, without
 *      query or hash, exactly `getURL(p)` for p ∈ {sidepanel, options, intervention}.
 *      Anything else → forbidden_sender. (The overlay sender class arrives on Day 09.)
 *   2. envelope validation (§1): exactly {v: 1, id, type, payload} (+ optional nonce),
 *      read from a plain-data snapshot; anything else → invalid_message.
 *   3. dispatch: session.* / break.* go to the engine; prefs.get and diag.get are
 *      queued reads. Other contract types → not_implemented; unknown → unknown_type.
 * Replies carry error codes only, never free text.
 */
import { SESSION_COMMAND_TYPES, type ErrorCode, type SessionCommandType } from "../../core/session";
import { trySnapshot } from "../../core/storage/snapshot";
import { isPlainObject } from "../../core/storage/validate";
import type { Engine } from "../engine/engine";

export const EXTENSION_PAGES = ["sidepanel.html", "options.html", "intervention.html"] as const;

/** Every command type in API_CONTRACTS §3 and §4. */
export const CONTRACT_TYPES: readonly string[] = [
  "parse.intent",
  "session.start",
  "session.pause",
  "session.resume",
  "session.continue",
  "session.extend",
  "session.stop",
  "session.updateNote",
  "relevant.preview",
  "session.addRelevant",
  "overrides.list",
  "overrides.remove",
  "break.start",
  "break.end",
  "break.extend",
  "recovery.focusLastTab",
  "notify.test",
  "audio.sample",
  "intervention.respond",
  "mute.set",
  "prefs.get",
  "prefs.update",
  "permissions.changed",
  "history.list",
  "summary.get",
  "summary.setObjectiveDone",
  "recorded.view",
  "data.deleteSession",
  "data.deleteAll",
  "diag.get",
  "overlay.response",
];

/** The parts of chrome.runtime.MessageSender the router reads. */
export type SenderInfo = { id?: string; url?: string; tab?: unknown; frameId?: number; documentId?: string };

export type Reply =
  { id: string; ok: true; data?: unknown } | { id: string; ok: false; error: ErrorCode; data?: unknown };

export type RouterDeps = {
  runtimeId: string;
  /** chrome.runtime.getURL */
  getURL: (path: string) => string;
  /** Resolves once storage is open and the Startup input is queued. */
  engine: () => Promise<Engine>;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TYPE = /^[a-z][A-Za-z]{0,30}\.[a-z][A-Za-z]{0,30}$/;
const ENVELOPE_REQUIRED = ["v", "id", "type", "payload"];
const ENVELOPE_KEYS = [...ENVELOPE_REQUIRED, "nonce"];

const isSessionCommand = (t: string): t is SessionCommandType => SESSION_COMMAND_TYPES.some((c) => c === t);

/** §2: an extension page of this extension, by exact URL. */
export function isExtensionPageSender(sender: SenderInfo, runtimeId: string, getURL: (p: string) => string): boolean {
  if (typeof sender.id !== "string" || sender.id !== runtimeId) return false;
  if (typeof sender.url !== "string") return false;
  const bare = sender.url.split(/[?#]/, 1)[0] ?? "";
  return EXTENSION_PAGES.some((p) => bare === getURL(p));
}

type Envelope = { id: string; type: string; payload: unknown };

function parseEnvelope(message: unknown): { ok: true; value: Envelope } | { ok: false; id: string } {
  const snap = trySnapshot(message);
  if (!snap.ok || !isPlainObject(snap.value)) return { ok: false, id: "" };
  const m = snap.value;
  const id = typeof m.id === "string" && ID.test(m.id) ? m.id : "";
  const keys = Object.keys(m);
  if (keys.some((k) => !ENVELOPE_KEYS.includes(k))) return { ok: false, id };
  if (ENVELOPE_REQUIRED.some((k) => !Object.hasOwn(m, k) || m[k] === undefined)) return { ok: false, id };
  if (m.v !== 1 || id === "" || typeof m.type !== "string" || !TYPE.test(m.type)) return { ok: false, id };
  if (m.nonce !== undefined && (typeof m.nonce !== "string" || m.nonce.length > 128)) return { ok: false, id };
  return { ok: true, value: { id, type: m.type, payload: m.payload } };
}

const isEmptyObject = (v: unknown): boolean => isPlainObject(v) && Object.keys(v).length === 0;

export function createRouter(deps: RouterDeps): { handle(message: unknown, sender: SenderInfo): Promise<Reply> } {
  const err = (id: string, error: ErrorCode, data?: unknown): Reply => ({
    id,
    ok: false,
    error,
    ...(data !== undefined && { data }),
  });

  async function dispatch(env: Envelope): Promise<Reply> {
    const { id, type, payload } = env;
    if (isSessionCommand(type)) {
      const engine = await deps.engine();
      const r = await engine.enqueue({ kind: "command", command: { type, payload } });
      if (r.ok) return { id, ok: true, ...(r.data !== undefined && { data: r.data }) };
      return err(id, r.error, r.data);
    }
    if (type === "prefs.get" || type === "diag.get") {
      if (!isEmptyObject(payload)) return err(id, "invalid_message");
      const engine = await deps.engine();
      if (type === "prefs.get") {
        const { prefs } = await engine.run((repos) => repos.prefs.get());
        return { id, ok: true, data: { prefs } };
      }
      const entries = await engine.run((repos) => repos.diag.list());
      return { id, ok: true, data: { entries } };
    }
    if (CONTRACT_TYPES.includes(type)) return err(id, "not_implemented");
    return err(id, "unknown_type");
  }

  return {
    async handle(message, sender) {
      if (!isExtensionPageSender(sender, deps.runtimeId, deps.getURL)) {
        const snap = trySnapshot(message);
        const raw = snap.ok && isPlainObject(snap.value) ? snap.value.id : undefined;
        return err(typeof raw === "string" && ID.test(raw) ? raw : "", "forbidden_sender");
      }
      const env = parseEnvelope(message);
      if (!env.ok) return err(env.id, "invalid_message");
      // §2: extension pages may send everything except overlay.response.
      if (env.value.type === "overlay.response") return err(env.value.id, "forbidden_sender");
      try {
        return await dispatch(env.value);
      } catch {
        return err(env.value.id, "internal");
      }
    },
  };
}
