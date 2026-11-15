// Focus Buddy Day 04 prototype helpers. Throwaway design mock, no build step.
// Needs messages.js (window.FB_MESSAGES) loaded first.
(function () {
  "use strict";

  // Reference scenario (UX task brief). Placeholder values for every {var} in the bank.
  const SCENARIO = {
    task: "Study Pattern Recognition",
    objective: "Finish chapters 1–4",
    planned: "3 h",
    nextStep: "Re-read the k-NN section in chapter 2",
    timeLeft: "2 h 14 min",
    time: "3:40 pm",
    lastTitle: "Pattern Recognition, chapter 2: k-NN",
    awayMin: "14",
    host: "youtube.com",
    words: "K Nearest Neighbors",
    minutes: "15",
    count: "3",
    actual: "2 h 50 min",
    focused: "2 h 10 min",
  };
  const SITES = ["claude.ai", "classroom.google.com", "scholar.google.com", "youtube.com"];

  const rotation = Object.create(null);

  // Truncate user text with an ellipsis (UX_GUIDELINES §5 rule 10).
  const LIMITS = { task: 40, objective: 60, nextStep: 80, lastTitle: 60, words: 60 };
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  /**
   * t(key, vars) -> string.
   * vars may contain any placeholder; missing ones fall back to SCENARIO.
   * Array entries: vars.index picks one; otherwise the entry rotates on each call.
   * A missing key is a console.error so the headless check catches it.
   */
  function t(key, vars) {
    const bank = window.FB_MESSAGES || {};
    let v = bank[key];
    if (v === undefined) {
      console.error("FB_MESSAGES: missing key " + key);
      return "[" + key + "]";
    }
    vars = vars || {};
    if (Array.isArray(v)) {
      let i;
      if (typeof vars.index === "number") i = vars.index % v.length;
      else { i = (rotation[key] || 0) % v.length; rotation[key] = i + 1; }
      v = v[i];
    }
    return v.replace(/\{(\w+)\}/g, function (m, name) {
      let val = vars[name] !== undefined ? vars[name] : SCENARIO[name];
      if (val === undefined) { console.error("FB_MESSAGES: no value for {" + name + "} in " + key); return m; }
      val = String(val);
      return LIMITS[name] ? trunc(val, LIMITS[name]) : val;
    });
  }

  /** Fill every [data-msg] element. Optional data-vars (JSON) and data-index. */
  function fill(root) {
    (root || document).querySelectorAll("[data-msg]").forEach(function (el) {
      const vars = el.dataset.vars ? JSON.parse(el.dataset.vars) : {};
      if (el.dataset.index !== undefined) vars.index = Number(el.dataset.index);
      el.textContent = t(el.dataset.msg, vars);
    });
  }

  // ---------- inline SVG icon sprite (shapes, never colour alone) ----------
  const ICONS = {
    "circle-filled": '<circle cx="12" cy="12" r="7" fill="currentColor"/>',
    "circle-open": '<circle cx="12" cy="12" r="7"/>',
    bubble: '<path d="M4 5h16v10H9l-5 4z"/>',
    "arrow-back": '<path d="M10 6l-6 6 6 6M4 12h11a5 5 0 0 1 0 10h-2"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    cup: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a3 3 0 0 1 0 6h-2M8 3v3M12 3v3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    pencil: '<path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    speaker: '<path d="M4 10h4l5-4v12l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
  };
  function injectSprite() {
    if (document.getElementById("fb-sprite")) return;
    const s = Object.keys(ICONS).map(function (k) {
      return '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + ICONS[k] + "</symbol>";
    }).join("");
    const div = document.createElement("div");
    div.innerHTML = '<svg id="fb-sprite" style="display:none" aria-hidden="true" focusable="false">' + s + "</svg>";
    document.body.prepend(div.firstChild);
  }
  /** Markup for a decorative icon (always aria-hidden; text sits next to it). */
  function icon(name, extraClass) {
    return '<svg class="icon ' + (extraClass || "") + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"/></svg>';
  }
  /** Replace <i data-icon="name"></i> placeholders with sprite icons. */
  function icons(root) {
    (root || document).querySelectorAll("i[data-icon]").forEach(function (el) {
      el.outerHTML = icon(el.dataset.icon, el.className);
    });
  }

  // ---------- simple state switching ----------
  /**
   * Shows the one [data-state] child of `root` whose value is `id` and hides the rest.
   * Returns the shown element (or null).
   */
  function showState(root, id) {
    let shown = null;
    root.querySelectorAll(":scope [data-state]").forEach(function (el) {
      const on = el.dataset.state === id;
      el.hidden = !on;
      if (on) shown = el;
    });
    return shown;
  }

  /** Move focus to an element that isn't normally focusable (heading etc.). */
  function focusEl(el) {
    if (!el) return;
    if (!el.matches("a[href],button,input,select,textarea,[tabindex]")) el.setAttribute("tabindex", "-1");
    el.focus();
  }

  /** Wire every button[aria-controls][aria-expanded] as a disclosure. */
  function disclosures(root) {
    (root || document).querySelectorAll("button[aria-expanded][aria-controls]").forEach(function (b) {
      if (b.dataset.wired) return;
      b.dataset.wired = "1";
      b.addEventListener("click", function () {
        const open = b.getAttribute("aria-expanded") !== "true";
        b.setAttribute("aria-expanded", String(open));
        const p = document.getElementById(b.getAttribute("aria-controls"));
        if (p) p.hidden = !open;
      });
    });
  }

  // Escape closes any open "More options" style disclosure that holds focus (or whose
  // button holds focus) and returns focus to its button (UX_GUIDELINES §7 Keyboard).
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    const a = document.activeElement;
    if (!a) return;
    const openBtns = document.querySelectorAll('button[aria-expanded="true"][aria-controls]');
    for (const b of openBtns) {
      const p = document.getElementById(b.getAttribute("aria-controls"));
      if (b === a || (p && p.contains(a))) {
        e.preventDefault();
        b.setAttribute("aria-expanded", "false");
        if (p) p.hidden = true;
        b.focus();
        return;
      }
    }
  });

  /** Inline help link for footers (same position on every page type, §7). */
  function helpLink() {
    return '<a href="index.html#how">' + t("label.help") + "</a>";
  }

  /** Make a group of toggle chips behave as single-select (aria-pressed). */
  function chipGroup(container, onPick) {
    container.addEventListener("click", function (e) {
      const b = e.target.closest("button.chip-toggle");
      if (!b || !container.contains(b)) return;
      container.querySelectorAll("button.chip-toggle").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      if (onPick) onPick(b.dataset.value, b);
    });
  }

  // ---------- sample sound (WebAudio, 0.6 s faded tone, no audio files) ----------
  let ctx = null;
  function tone(volume) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const v = Math.max(0, Math.min(1, volume === undefined ? 0.5 : volume)) * 0.3;
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.6);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.62);
    } catch (err) {
      console.warn("Sample sound unavailable", err);
    }
  }

  /**
   * Standard intervention action set (UX_GUIDELINES F4): Back to task (primary),
   * This is relevant, Take a break, More options -> Mute, End session.
   * At most 3 buttons + More are visible (U3). Buttons carry data-act for the page to handle.
   */
  function driftActions(prefix, opts) {
    opts = opts || {};
    const more = prefix + "-more";
    return '<div class="actions">' +
      '<button type="button" class="btn-primary" data-act="back">' + t("action.back") + "</button>" +
      (opts.noRelevant ? "" : '<button type="button" data-act="relevant">' + t("action.relevant") + "</button>") +
      '<button type="button" data-act="break">' + t("action.break") + "</button>" +
      '<button type="button" aria-expanded="false" aria-controls="' + more + '">' + t("action.more") + icon("chevron", "chev") + "</button>" +
      "</div>" +
      '<div class="disclosure-panel" id="' + more + '" hidden><ul>' +
      '<li><button type="button" data-act="mute">' + t("action.mute") + "</button></li>" +
      '<li><button type="button" data-act="stop">' + t("label.endSessionMenu") + "</button></li>" +
      "</ul></div>";
  }
  /** Replace every [data-actions] placeholder with the standard action set. */
  function actionSets(root) {
    (root || document).querySelectorAll("[data-actions]").forEach(function (el) {
      el.innerHTML = driftActions(el.dataset.actions, { noRelevant: el.hasAttribute("data-no-relevant") });
    });
  }

  function init() {
    injectSprite();
    actionSets();
    icons();
    fill();
    disclosures();
  }

  window.FB = { t: t, fill: fill, icon: icon, icons: icons, showState: showState, focusEl: focusEl, disclosures: disclosures, chipGroup: chipGroup, tone: tone, helpLink: helpLink, driftActions: driftActions, actionSets: actionSets, SCENARIO: SCENARIO, SITES: SITES, init: init };
})();
