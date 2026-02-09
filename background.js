// Minimal background service worker.
// Exposes chrome.storage.local via message passing so Playwright E2E tests
// (and potentially other extension pages) can read/write stored preferences.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getStorage") {
    chrome.storage.local.get(message.keys ?? null, (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse(result);
      }
    });
    return true; // keep channel open for async response
  }

  if (message.type === "setStorage") {
    chrome.storage.local.set(message.data, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  if (message.type === "clearStorage") {
    chrome.storage.local.clear(() => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }
});
