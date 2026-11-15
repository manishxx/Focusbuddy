// Injected into the isolated world: can a closed-shadow-root <dialog> use showModal (top layer, page inert)? (V8 / UX-5)
(() => {
  const host = document.createElement("div");
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "closed" });
  const dlg = document.createElement("dialog");
  dlg.innerHTML = "<p>probe</p><button>ok</button>";
  root.appendChild(dlg);
  const out = {};
  try { dlg.showModal(); out.showModal = "ok"; } catch (e) { out.showModal = "error: " + e.message; }
  out.modal = dlg.matches(":modal");
  const r = dlg.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  out.hitIsHost = hit === host;
  const pageBtn = document.getElementById("page-btn");
  pageBtn.focus();
  out.pageButtonFocusable = document.activeElement === pageBtn;
  // Cover-up test: can a page element with max z-index sit above the top-layer dialog?
  const cover = document.getElementById("cover");
  cover.style.display = "block";
  const hit2 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  out.coverWins = hit2 === cover;
  document.documentElement.dataset.v8 = JSON.stringify(out);
  return out;
})();
