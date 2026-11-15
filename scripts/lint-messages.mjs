// Banned-phrase lint for the message bank (AC-31). Runs in CI (ADR-0007).
// Usage: node scripts/lint-messages.mjs [messages.json] [banned.json]
import { readFileSync } from "node:fs";
const [mPath = "src/core/messages/messages.json", bPath = "src/core/messages/banned-phrases.json"] = process.argv.slice(2);
const { messages } = JSON.parse(readFileSync(mPath, "utf8"));
const banned = JSON.parse(readFileSync(bPath, "utf8"));
const pats = banned.patterns.map(p => ({ ...p, rx: new RegExp(p.re, "i") }));

// Collapse letter-spacing ("Y O U  F A I L E D" -> "YOU FAILED") and fill placeholders with neutral text.
const normalise = s => s.replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "")
  .replace(/\{(minutes|awayMin|count|n)\}/g, "12").replace(/\{[^}]+\}/g, "Study")
  .replace(/\b(?:[A-Za-z]-){2,}[A-Za-z]\b/g, m => m.replace(/-/g, ""))
  .replace(/\b(?:[A-Za-z] ){2,}[A-Za-z]\b/g, m => m.replace(/ /g, ""))
  .replace(/(?<=[a-z])[10345@](?=[a-z])/gi, c => ({ 1: "i", 0: "o", 3: "e", 4: "a", 5: "s", "@": "a" })[c])
  .replace(/[._*~]+/g, " ");
const stripAllowed = (key, s) => banned.allow.filter(a => a.key === key).reduce((t, a) => t.split(a.match).join(" "), s);
const hits = s => pats.map((p, i) => ({ ...p, i })).filter(p => p.rx.test(s) || p.rx.test(normalise(s)));
const genericFor = k => [k + ".generic", k.replace(/\.[^.]+$/, "") + ".generic"].some(g => g in messages);

const ALERT = /^(nudge\.|alert\.|overlay\.title|break\.over|continue\.(title|body)|start\.|mute\.shortcut)/;
const NOTIFICATION = /^(start\.|nudge\.|alert\.|overlay\.title|break\.over\.|continue\.(title|body)|mute\.shortcut|tooltip\.)/;
const words = s => s.replace(/\{[^}]+\}/g, "X").trim().split(/\s+/).length;
const errors = [];
let checked = 0;
for (const [key, val] of Object.entries(messages)) {
  const list = Array.isArray(val) ? val : [val];
  list.forEach((s, i) => {
    checked++;
    const id = Array.isArray(val) ? `${key}[${i}]` : key;
    for (const p of hits(stripAllowed(key, s)))
      errors.push(`${id}: banned #${p.i} /${p.re}/ (${p.why}) in "${s}"`);
    const limit = ALERT.test(key) ? 15 : 25;
    if (words(s) > limit) errors.push(`${id}: ${words(s)} words, limit ${limit}`);
    if (ALERT.test(key) && s.includes("!")) errors.push(`${id}: exclamation mark in alert`);
    if (key.endsWith(".generic") && /\{(task|objective|nextStep|lastTitle|words|host)\}/i.test(s))
      errors.push(`${id}: generic variant leaks a private placeholder`);
  });
  const hasTask = (Array.isArray(val) ? val : [val]).some(s => /\{task\}/i.test(s));
  if (hasTask && NOTIFICATION.test(key) && !key.endsWith(".generic") && !genericFor(key))
    errors.push(`${key}: notification/tooltip text uses {task} but has no ${key}.generic`);
}
for (const a of banned.allow) if (!(a.key in messages) || !String(messages[a.key]).includes(a.match)) errors.push(`allow entry ${a.key} doesn't match the bank`);

// Self-test: known-bad strings (incl. the Day 04 reviewer's adversarial set) must be caught,
// known-good strings must pass.
const bad = ["You failed again!!", "Stop wasting time", "Just get back to work", "You've been distracted",
  "This app can treat ADHD", "You've been on YouTube for 6 minutes", "You were away for 45 min.",
  "Off task for 12 min. Focus.", "Yet another detour. Back to work.", "Unproductive tab detected.",
  "Focus Buddy saw you on Netflix.", "Your ADHD brain is acting up.", "That's the third time this hour.",
  "You promised to study.", "Y O U  F A I L E D", "Drifted again?", "12 minutes on Reddit.", "Your focus score: 62%",
  "Stop scrolling. Do your work.", "You're behind schedule. Hurry up.", "fa\u00adiled", "Don't give up now", "Gone for 20 minutes.",
  "Twenty minutes elsewhere.", "Off track for 12 min.", "This is the 2nd check-in.", "Not again.", "Y-O-U F-A-I-L-E-D",
  "Fa1led", "You slipped.", "Could do better."];
const good = ["Try again", "Titles are checked only while a session is running.", "Something went wrong on our side. Your session is still running.",
  "Back to Study?", "Ready when you are.", "Break started. Back at 3:40 pm.", "Add 5 minutes",
  "Ready to focus.", "Volume: 50%", "Caught up in something?", "Step 2 of 3", "Muted until 4:40 pm"];
const allowProbe = hits(stripAllowed("continue.panel", "You were away for about {awayMin} min. You've been on YouTube for 6 minutes."));
if (!allowProbe.length) errors.push("self-test: allow entry hides extra time-away text");
const missed = bad.filter(s => hits(s).length === 0);
const falsePos = good.filter(s => hits(s).length > 0);
if (missed.length) errors.push(`self-test: missed bad ${JSON.stringify(missed)}`);
if (falsePos.length) errors.push(`self-test: flagged good ${JSON.stringify(falsePos)}`);
console.log(`checked ${checked} strings; self-test bad ${bad.length - missed.length}/${bad.length} caught, good ${good.length - falsePos.length}/${good.length} passed`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("message bank lint: PASS");
