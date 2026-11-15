// Plays a short generated tone (no audio asset needed). Reports AudioContext state.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.cmd !== "beep") return false;
  (async () => {
    try {
      const ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, msg.volume ?? 0.3));
      osc.frequency.value = 660;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      sendResponse({ ok: true, state: ctx.state, volume: gain.gain.value });
    } catch (e) {
      sendResponse({ ok: false, e: String(e) });
    }
  })();
  return true;
});
