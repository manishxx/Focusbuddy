// Content script (isolated world): can it read storage.local? (V1)
chrome.storage.local.get("probeSecret").then(
  v => { document.documentElement.dataset.v1 = "read:" + JSON.stringify(v); },
  e => { document.documentElement.dataset.v1 = "error:" + e.message; }
);
