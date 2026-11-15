// Spike overlay: dismissible full-page interruption with countdown.
// Buttons work during the countdown; Escape dismisses immediately (FR-I6).
(() => {
  if (document.getElementById("fb-spike-overlay-host")) return;
  const host = document.createElement("div");
  host.id = "fb-spike-overlay-host";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.innerHTML = `
    <style>
      .bg{position:fixed;inset:0;background:rgba(20,24,40,.82);display:grid;place-items:center;font:16px system-ui;${reduce ? "" : "animation:f .2s ease-out"}}
      @keyframes f{from{opacity:0}to{opacity:1}}
      .card{background:#fff;color:#111;border-radius:12px;padding:24px;max-width:420px;text-align:center}
      button{font:inherit;padding:10px 16px;margin:6px;border-radius:8px;border:1px solid #444;cursor:pointer}
    </style>
    <div class="bg" role="dialog" aria-modal="true" aria-labelledby="h">
      <div class="card">
        <h2 id="h">Back to Pattern Recognition?</h2>
        <p>Pausing for <span id="c">5</span> s. You can choose now.</p>
        <button id="back">Back to task</button>
        <button id="cont">Continue anyway</button>
      </div>
    </div>`;
  const send = (ev) => { try { chrome.runtime.sendMessage({ type: "overlay_event", ev }); } catch {} };
  const close = (ev) => { clearInterval(timer); removeEventListener("keydown", onKey, true); host.remove(); send(ev); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close("escape"); } };
  addEventListener("keydown", onKey, true);
  root.getElementById("back").onclick = () => close("back");
  root.getElementById("cont").onclick = () => close("continue");
  let n = 5;
  const timer = setInterval(() => { n -= 1; root.getElementById("c").textContent = String(Math.max(n, 0)); if (n <= 0) clearInterval(timer); }, 1000);
  document.documentElement.appendChild(host);
  root.getElementById("back").focus();
  send("shown");
})();
