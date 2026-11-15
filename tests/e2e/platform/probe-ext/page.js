// Extension page: can it fetch its own bundled file (V4) and is an external fetch blocked (CSP control)?
self.pageProbe = async (ext) => {
  const out = {};
  try { const r = await fetch(chrome.runtime.getURL("pack.json")); out.selfFetch = "allowed " + r.status + " " + JSON.stringify(await r.json()); }
  catch (e) { out.selfFetch = "blocked: " + e.message; }
  try { const r = await fetch(ext, { cache: "no-store" }); out.externalFetch = "allowed status " + r.status; }
  catch (e) { out.externalFetch = "blocked: " + e.message; }
  return out;
};
