// Plays a short generated tone (no audio asset needed) and reports diagnostics.
// mode "new"  : a fresh AudioContext per beep (original Day 2 behaviour; never closed)
// mode "reuse": one shared AudioContext for every beep
let shared = null;
let created = 0;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.cmd !== "beep") return false;
  (async () => {
    try {
      let ctx;
      if (msg.mode === "reuse") {
        if (!shared || shared.state === "closed") { shared = new AudioContext(); created++; }
        ctx = shared;
      } else {
        ctx = new AudioContext(); created++;
      }
      const stateBefore = ctx.state;
      if (ctx.state === "suspended") await ctx.resume();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const vol = Math.max(0, Math.min(1, msg.volume ?? 0.3));
      // Short fade in/out so each beep is a clean, distinct sound.
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.03);
      gain.gain.setValueAtTime(vol, t + 0.55);
      gain.gain.linearRampToValueAtTime(0, t + 0.6);
      osc.frequency.value = msg.freq ?? 660;
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.62);
      sendResponse({
        ok: true, mode: msg.mode || "new", freq: osc.frequency.value, stateBefore, state: ctx.state,
        currentTime: Math.round(t * 1000) / 1000, sampleRate: ctx.sampleRate,
        baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, contextsCreated: created,
      });
    } catch (e) {
      sendResponse({ ok: false, e: String(e), contextsCreated: created });
    }
  })();
  return true;
});
