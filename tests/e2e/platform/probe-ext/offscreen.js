chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.probe === "who") {
    sendResponse({ url: sender.url ?? null, id: sender.id ?? null, origin: sender.origin ?? null, hasTab: !!sender.tab, documentId: sender.documentId ?? null, frameId: sender.frameId ?? null });
  }
  return false;
});
