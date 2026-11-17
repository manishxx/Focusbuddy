// Day 07 e2e: AC-02 (no duplicate notification and no time drift across a service-worker
// restart), and the first real-Chrome run of the Day 06 storage layer.
//
//   1. Install dist/ and open sidepanel.html as a tab (an exact extension-page sender).
//   2. From that page, send session.start (180-min draft) with the API_CONTRACTS §1 envelope.
//   3. Read the UiSnapshot from storage.session.
//   4. Stop the SW (CDP ServiceWorker.stopAllWorkers), wait 3 s, wake it with prefs.get.
//   5. Assert: endsAt unchanged (±1 s); exactly one notification (the start one), read in
//      the SW; badge "ON"; session.active valid in storage.local; no SessionRecord yet.
//   6. session.pause; restart the SW again; assert: still PAUSED, the frozen endsAt is
//      unchanged, and the alarm set is exactly fb.stalePause.
//   7. session.stop, then assert: a SessionRecord in IndexedDB `fb`, session.active
//      removed, every alarm cleared, snapshot session null with lastSummaryId.
//
// Builds nothing itself: run `npm run build` first.
// Usage: node tests/e2e/session-restart.mjs   Env: CHROME_PATH (default: local Google Chrome)
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(root, "dist");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const summary = { ok: false, chrome: null, extensionId: null, steps: {}, checks: [], errors: [] };
const fail = (msg) => summary.errors.push(msg);
const check = (name, pass, detail) => {
  summary.checks.push({ name, pass: !!pass, ...(detail !== undefined && { detail }) });
  if (!pass) fail(`check failed: ${name}`);
};
const done = () => {
  summary.ok = summary.errors.length === 0 && summary.checks.length > 0 && summary.checks.every((c) => c.pass);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
};

if (!existsSync(join(dist, "manifest.json"))) {
  fail("dist/manifest.json missing; run npm run build first");
  done();
}
if (!existsSync(CHROME)) {
  fail(`Chrome not found at ${CHROME} (set CHROME_PATH)`);
  done();
}

// The exact ActiveState keys (DATA_MODEL v1.3 §2); the validators reject anything else.
const ACTIVE_REQUIRED = [
  "schemaVersion",
  "session",
  "lastSeenAt",
  "attention",
  "attentionSince",
  "awayMs",
  "notified",
  "drift",
  "policy",
  "sessionOverrides",
  "segSeq",
];
const ACTIVE_OPTIONAL = ["current", "lastRelevant", "pending"];
const SESSION_REQUIRED = [
  "taskLabel",
  "objective",
  "allowedHosts",
  "keywords",
  "mode",
  "id",
  "state",
  "startedAt",
  "plannedMin",
  "extensionsMin",
  "pauses",
];
const SESSION_OPTIONAL = ["nextStep", "breakEndsAt", "ending", "awaitingContinue", "awaySince"];
const keysOk = (obj, required, optional) =>
  !!obj &&
  required.every((k) => k in obj) &&
  Object.keys(obj).every((k) => required.includes(k) || optional.includes(k));

/** Structural check of session.active against DATA_MODEL v1.3 (the TS validator can't load here). */
function activeProblems(a, sessionId, state = "ACTIVE") {
  const p = [];
  if (!keysOk(a, ACTIVE_REQUIRED, ACTIVE_OPTIONAL)) p.push("active: keys");
  if (a?.schemaVersion !== 1) p.push("active.schemaVersion");
  const s = a?.session;
  if (!keysOk(s, SESSION_REQUIRED, SESSION_OPTIONAL)) p.push("session: keys");
  if (s?.id !== sessionId || !/^[A-Za-z0-9_-]{1,64}$/.test(s?.id ?? "")) p.push("session.id");
  if (s?.state !== state) p.push("session.state");
  if (s?.plannedMin !== 180 || s?.extensionsMin !== 0) p.push("session.plannedMin/extensionsMin");
  const wantPauses = state === "PAUSED" ? 1 : 0;
  if (!Array.isArray(s?.pauses) || s.pauses.length !== wantPauses) p.push("session.pauses");
  if (state === "PAUSED" && (s.pauses[0]?.kind !== "pause" || s.pauses[0]?.to !== undefined)) p.push("open pause");
  if (a?.awayMs !== 0) p.push("awayMs (no browser-closed gap expected)");
  if (!(a?.lastSeenAt >= s?.startedAt)) p.push("lastSeenAt < startedAt");
  // Review F1: an idle machine (or headless CI) may report idle/locked; any valid value is fine.
  if (!["ACTIVE_INPUT", "IDLE", "LOCKED", "BROWSER_UNFOCUSED"].includes(a?.attention)) p.push("attention");
  if (!(a?.attentionSince >= s?.startedAt)) p.push("attentionSince");
  if (typeof a?.notified?.start !== "number" || Object.keys(a?.notified ?? {}).some((k) => k !== "start"))
    p.push("notified");
  for (const forbidden of ["title", "url", "path"]) if (JSON.stringify(a).includes(`"${forbidden}"`)) p.push(forbidden);
  return p;
}

const profile = mkdtempSync(join(tmpdir(), "fb-session-"));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    enableExtensions: true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  summary.chrome = await browser.version();
  const extId = await browser.installExtension(dist);
  const origin = `chrome-extension://${extId}/`;
  summary.extensionId = extId;
  const isSw = (t) => t.type() === "service_worker" && t.url() === `${origin}sw.js`;
  await browser.waitForTarget(isSw, { timeout: 15_000 });

  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));
  await page.goto(origin + "sidepanel.html", { waitUntil: "load", timeout: 15_000 });

  let seq = 0;
  const send = (type, payload) =>
    page.evaluate((m) => chrome.runtime.sendMessage(m), { v: 1, id: `e2e-${++seq}`, type, payload });
  const readSnapshot = () =>
    page.evaluate(async () => (await chrome.storage.session.get("ui.snapshot"))["ui.snapshot"]);
  const readActive = () =>
    page.evaluate(async () => (await chrome.storage.local.get("session.active"))["session.active"]);
  const readIdb = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open("fb");
          req.onerror = () => reject(new Error("open failed"));
          req.onsuccess = () => {
            const db = req.result;
            const stores = [...db.objectStoreNames];
            const tx = db.transaction(["sessions", "segments"], "readonly");
            const sessions = tx.objectStore("sessions").getAll();
            const segments = tx.objectStore("segments").count();
            tx.oncomplete = () => {
              db.close();
              resolve({ version: db.version, stores, sessions: sessions.result, segments: segments.result });
            };
            tx.onerror = () => reject(new Error("tx failed"));
          };
        }),
    );
  // Chrome state as seen by the extension. NOTE: a Puppeteer WebWorker handle attached
  // to the SW before stopAllWorkers keeps the stopped worker's target and blocks its
  // restart (seen on Chrome 157). So swState() evaluates in the SW through a raw CDP
  // session that is detached right after, and pageState() reads the same APIs from the page.
  const stateFn = async () => ({
    idleState: await chrome.idle.queryState(300),
    notifications: Object.keys(await chrome.notifications.getAll()),
    badge: await chrome.action.getBadgeText({}),
    title: await chrome.action.getTitle({}),
    alarms: (await chrome.alarms.getAll()).map((a) => a.name).sort(),
  });
  const pageState = () => page.evaluate(stateFn);
  const swEval = async (fn, arg) => {
    const target = await browser.waitForTarget(isSw, { timeout: 15_000 });
    const session = await target.createCDPSession();
    try {
      const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
        expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) throw new Error(`SW evaluate failed: ${exceptionDetails.text}`);
      return result.value;
    } finally {
      await session.detach().catch(() => undefined);
    }
  };
  const swState = () => swEval(stateFn);
  // Review F1: chrome.idle.queryState and the stored attention, read together in the SW.
  const IDLE_TO_ATTENTION = { active: "ACTIVE_INPUT", idle: "IDLE", locked: "LOCKED" };
  const readAttentionPair = (thresholdSec) =>
    swEval(async (sec) => {
      const [idle, items] = await Promise.all([
        chrome.idle.queryState(sec),
        chrome.storage.local.get("session.active"),
      ]);
      return { idleState: idle, attention: items["session.active"]?.attention ?? null };
    }, thresholdSec);
  /** Stops every SW, waits 3 s, wakes ours with prefs.get (queued behind Startup). */
  const cdp = await page.createCDPSession();
  await cdp.send("ServiceWorker.enable");
  // Review F2: sw.ts writes diag.boot = {seq, at} on every evaluation.
  const readBoot = () => page.evaluate(async () => (await chrome.storage.session.get("diag.boot"))["diag.boot"]);
  const restartSw = async () => {
    const bootBefore = await readBoot();
    const stopAt = Date.now();
    await cdp.send("ServiceWorker.stopAllWorkers");
    await sleep(500);
    const targetsAfterStop = browser.targets().filter(isSw).length;
    await sleep(2_500);
    const wake = await send("prefs.get", {});
    const bootAfter = await readBoot();
    const boot = { before: bootBefore, after: bootAfter, stopAt };
    summary.steps.boots = [...(summary.steps.boots ?? []), boot];
    return { targetsAfterStop, wake, boot };
  };
  const bootProof = (boot) =>
    Number.isInteger(boot.before?.seq) && boot.after?.seq > boot.before.seq && boot.after?.at > boot.stopAt;

  // ---- 1. start ----
  const draft = {
    taskLabel: "E2E restart check",
    objective: "Verify AC-02",
    allowedHosts: ["docs.example.com"],
    keywords: ["restart"],
    plannedMin: 180,
  };
  const startReply = await send("session.start", { draft });
  summary.steps.start = startReply;
  const sessionId = startReply?.data?.sessionId;
  check("session.start replies ok with a sessionId", startReply?.ok === true && typeof sessionId === "string");
  const before = await readSnapshot();
  summary.steps.snapshotBefore = before;
  check(
    "snapshot before restart shows the ACTIVE session",
    before?.session?.id === sessionId && before?.session?.state === "ACTIVE",
  );
  check("snapshot endsAt ≈ start + 180 min", Math.abs(before?.session?.endsAt - (before?.at + 180 * 60_000)) < 5_000);
  const pageBefore = await pageState();
  summary.steps.stateBeforeRestartFromPage = pageBefore;
  check(
    "before restart: one notification, badge ON",
    pageBefore.notifications.length === 1 && pageBefore.badge === "ON",
  );

  // ---- 2. stop the SW, wait 3 s, wake it with prefs.get ----
  const restart1 = await restartSw();
  const wake = restart1.wake;
  summary.steps.swTargetsAfterStop = restart1.targetsAfterStop;
  summary.steps.wake = { ok: wake?.ok, idleThresholdSec: wake?.data?.prefs?.idleThresholdSec };
  check(
    "boot marker: seq increased and stamped after the stop (real restart)",
    bootProof(restart1.boot),
    restart1.boot,
  );
  check("prefs.get wakes the SW and replies ok", wake?.ok === true && wake?.data?.prefs?.schemaVersion === 1);

  // prefs.get is queued behind Startup, so reconciliation has finished when it replies.
  const after = await readSnapshot();
  summary.steps.snapshotAfter = after;
  const drift = (after?.session?.endsAt ?? NaN) - (before?.session?.endsAt ?? NaN);
  summary.steps.endsAtDeltaMs = drift;
  check("SW target was gone after stopAllWorkers", summary.steps.swTargetsAfterStop === 0);
  check("endsAt unchanged across the restart (±1 s)", Math.abs(drift) <= 1_000, { deltaMs: drift });
  check("snapshot republished after the restart", after?.at > before?.at);
  const swAfter = await swState();
  summary.steps.swAfter = swAfter;
  check(
    "exactly one notification, the start one",
    swAfter.notifications.length === 1 && swAfter.notifications[0] === `fb.start.${sessionId}`,
    swAfter.notifications,
  );
  check("badge text is ON", swAfter.badge === "ON");
  check(
    "alarms fb.sessionEnd and fb.tick exist",
    ["fb.sessionEnd", "fb.tick"].every((n) => swAfter.alarms.includes(n)),
    swAfter.alarms,
  );
  const active = await readActive();
  summary.steps.activeAfterRestart = active;
  summary.steps.idleStateInSw = swAfter.idleState;
  // Must match chrome.idle; a mismatch is tolerated only if a second read 1 s later
  // agrees (an idle transition racing the first read).
  const threshold = wake?.data?.prefs?.idleThresholdSec ?? 300;
  const first = await readAttentionPair(threshold);
  const matches = (r) => IDLE_TO_ATTENTION[r.idleState] === r.attention;
  let second = null;
  if (!matches(first)) {
    await sleep(1_000);
    second = await readAttentionPair(threshold);
  }
  summary.steps.attentionVsIdle = { thresholdSec: threshold, first, second };
  check(
    "stored attention matches chrome.idle.queryState in the SW",
    matches(first) || (second !== null && matches(second)),
    {
      first,
      second,
    },
  );
  const problems = activeProblems(active, sessionId);
  check("session.active is valid (DATA_MODEL v1.3 shape)", problems.length === 0, problems);
  const idbActive = await readIdb();
  summary.steps.idbWhileActive = {
    version: idbActive.version,
    stores: idbActive.stores,
    sessions: idbActive.sessions.length,
    segments: idbActive.segments,
  };
  check(
    "IndexedDB fb v1 has its stores and no SessionRecord while active",
    idbActive.version === 1 &&
      ["interventions", "segments", "sessions"].every((s) => idbActive.stores.includes(s)) &&
      idbActive.sessions.length === 0,
  );

  // ---- 3. pause, restart the SW again: still PAUSED, frozen endsAt, fb.stalePause only ----
  const pauseReply = await send("session.pause", {});
  summary.steps.pause = pauseReply;
  check("session.pause replies ok", pauseReply?.ok === true);
  const pausedBefore = await readSnapshot();
  summary.steps.snapshotPaused = pausedBefore;
  check(
    "snapshot shows PAUSED with pausedAt",
    pausedBefore?.session?.state === "PAUSED" && typeof pausedBefore?.session?.pausedAt === "number",
  );
  const restart2 = await restartSw();
  summary.steps.restart2 = { targetsAfterStop: restart2.targetsAfterStop, wakeOk: restart2.wake?.ok };
  check("second restart: SW stopped and woke", restart2.targetsAfterStop === 0 && restart2.wake?.ok === true);
  check("boot marker: seq increased again after the second stop", bootProof(restart2.boot), restart2.boot);
  const pausedAfter = await readSnapshot();
  summary.steps.snapshotPausedAfterRestart = pausedAfter;
  check("still PAUSED after the second restart", pausedAfter?.session?.state === "PAUSED");
  const frozenDelta = (pausedAfter?.session?.endsAt ?? NaN) - (pausedBefore?.session?.endsAt ?? NaN);
  summary.steps.pausedEndsAtDeltaMs = frozenDelta;
  check("frozen endsAt unchanged across the second restart", frozenDelta === 0, { deltaMs: frozenDelta });
  check("pausedAt unchanged", pausedAfter?.session?.pausedAt === pausedBefore?.session?.pausedAt);
  const swPaused = await swState();
  summary.steps.swPausedAfterRestart = swPaused;
  check("alarm set is exactly fb.stalePause", JSON.stringify(swPaused.alarms) === '["fb.stalePause"]', swPaused.alarms);
  check("badge text is II", swPaused.badge === "II");
  check(
    "still exactly one notification, the start one",
    swPaused.notifications.length === 1 && swPaused.notifications[0] === `fb.start.${sessionId}`,
    swPaused.notifications,
  );
  const activePaused = await readActive();
  summary.steps.activePausedAfterRestart = activePaused;
  const pausedProblems = activeProblems(activePaused, sessionId, "PAUSED");
  check("session.active is valid and PAUSED", pausedProblems.length === 0, pausedProblems);

  // ---- 4. stop the session ----
  const stopReply = await send("session.stop", {});
  summary.steps.stop = stopReply;
  check("session.stop replies ok", stopReply?.ok === true);
  const idbEnded = await readIdb();
  const record = idbEnded.sessions.find((r) => r.id === sessionId);
  summary.steps.sessionRecord = record ?? null;
  check(
    "a SessionRecord exists in IndexedDB fb",
    !!record && record.endReason === "user_stop" && record.plannedMin === 180,
  );
  check("no segments remain", idbEnded.segments === 0);
  check("session.active removed", (await readActive()) === undefined);
  const swEnded = await swState();
  summary.steps.swEnded = swEnded;
  check("every alarm cleared", swEnded.alarms.length === 0, swEnded.alarms);
  check("badge cleared", swEnded.badge === "");
  check("start notification cleared", swEnded.notifications.length === 0, swEnded.notifications);
  const ended = await readSnapshot();
  summary.steps.snapshotEnded = ended;
  check("snapshot session null with lastSummaryId", ended?.session === null && ended?.lastSummaryId === sessionId);
  check("no page errors", pageErrors.length === 0, pageErrors);
} catch (err) {
  fail(`harness: ${err?.message ?? err}`);
} finally {
  await browser?.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true });
}

done();
