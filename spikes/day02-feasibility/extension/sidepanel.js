const $ = (id) => document.getElementById(id);
const call = (cmd, extra = {}) => chrome.runtime.sendMessage({ cmd, ...extra });
const show = (r) => { $("status").textContent = JSON.stringify(r); };

$("notify").onclick = async () => show(await call("notify", { buttons: 2 }));
$("notify3").onclick = async () => show(await call("notify", { buttons: 3 }));
$("sound").onclick = async () => show(await call("playSound", { volume: 0.3 }));
$("perm").onclick = async () => {
  try { show({ granted: await chrome.permissions.request({ origins: ["<all_urls>"] }) }); }
  catch (e) { show({ error: String(e) }); }
};
$("overlay").onclick = async () => show(await call("injectOverlay"));
$("clear").onclick = async () => show(await call("clearLog"));

async function render() {
  const { log = [] } = await chrome.storage.local.get("log");
  $("log").textContent = log.slice(-40).reverse()
    .map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.type} ${JSON.stringify({ ...e, t: undefined, type: undefined })}`)
    .join("\n");
}
chrome.storage.onChanged.addListener((c) => { if (c.log) render(); });
render();
