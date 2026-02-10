// Pro By Default – content script
// Persists the user's Gemini model choice across new chats.

(function () {
  "use strict";

  const STORAGE_KEY = "preferredModel";
  const DEFAULT_MODEL = "Pro";
  const LOG_PREFIX = "[ProByDefault]";

  // ── Selectors (based on Gemini's actual DOM) ─────────────────────────
  // The model picker button that opens the dropdown.
  const PICKER_BUTTON_SEL = '[data-test-id="bard-mode-menu-button"]';
  // The label inside the picker that shows the current model name.
  const PICKER_LABEL_SEL = '[data-test-id="logo-pill-label-container"]';
  // Individual model options inside the opened dropdown.
  const MODE_OPTION_SEL = 'button[role="menuitemradio"][data-test-id^="bard-mode-option-"]';
  // ── State ────────────────────────────────────────────────────────────
  let isRestoring = false;
  let lastUrl = location.href;

  // ── Logging helpers ──────────────────────────────────────────────────
  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }
  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  // ── Context guard ─────────────────────────────────────────────────────
  /** Returns true if the extension context has been invalidated (e.g. after
   *  an extension reload). All chrome.* API calls would throw in that state. */
  function isContextInvalidated() {
    return !chrome.runtime?.id;
  }

  // ── Storage helpers (chrome.storage.local) ───────────────────────────
  function getPreferred() {
    return new Promise((resolve) => {
      if (isContextInvalidated()) {
        warn("Extension context invalidated – cannot read storage.");
        resolve(null);
        return;
      }
      try {
        chrome.storage.local.get(STORAGE_KEY, (res) =>
          resolve(res[STORAGE_KEY] ?? null),
        );
      } catch {
        warn("Extension context invalidated – cannot read storage.");
        resolve(null);
      }
    });
  }

  function setPreferred(model) {
    if (isContextInvalidated()) {
      warn("Extension context invalidated – cannot write storage.");
      return Promise.resolve();
    }
    log("Saving preferred model:", model);
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: model }, resolve);
      } catch {
        warn("Extension context invalidated – cannot write storage.");
        resolve();
      }
    });
  }

  // ── DOM helpers ──────────────────────────────────────────────────────

  /** Read the current model name from the picker label. */
  function readCurrentModel() {
    const label = document.querySelector(PICKER_LABEL_SEL);
    return label ? label.textContent.trim() : null;
  }

  /** Find the picker button element. */
  function findPickerButton() {
    return document.querySelector(PICKER_BUTTON_SEL);
  }

  /**
   * Open the model dropdown and click the option matching `targetModel`.
   * Returns true on success.
   */
  async function selectModel(targetModel) {
    log("Attempting to restore model:", targetModel);

    const btn = findPickerButton();
    if (!btn) {
      warn("Picker button not found.");
      return false;
    }

    // Open the dropdown
    btn.click();

    // Wait for dropdown options to render
    const option = await waitForOption(targetModel, 3000);
    if (!option) {
      warn("Option not found for model:", targetModel);
      // Close dropdown (toggle the picker button)
      btn.click();
      return false;
    }

    option.click();
    log("Clicked option for:", targetModel);
    return true;
  }

  /**
   * Wait for a dropdown option whose `.mode-title` text matches the target.
   */
  function waitForOption(targetModel, timeoutMs) {
    const target = targetModel.toLowerCase().trim();
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;

      function search() {
        const options = document.querySelectorAll(MODE_OPTION_SEL);
        for (const opt of options) {
          const title = opt.querySelector(".mode-title");
          if (title && title.textContent.trim().toLowerCase() === target) {
            resolve(opt);
            return;
          }
        }
        if (Date.now() < deadline) {
          setTimeout(search, 100);
        } else {
          resolve(null);
        }
      }

      search();
    });
  }

  // ── Core logic ───────────────────────────────────────────────────────

  async function init() {
    log("Initialising (URL:", location.href, ")");

    // Wait for the picker label to appear in the DOM
    const label = await waitForElement(PICKER_LABEL_SEL, 10000);
    if (!label) {
      warn("Picker label not found on this page.");
      return;
    }

    const currentModel = readCurrentModel();
    log("Current model on page:", currentModel);

    const preferred = await getPreferred();
    const targetModel = preferred ?? DEFAULT_MODEL;
    log("Stored preference:", preferred, "| Target model:", targetModel);

    // Restore if needed
    if (
      currentModel &&
      currentModel.toLowerCase() !== targetModel.toLowerCase()
    ) {
      log("Model mismatch – restoring to:", targetModel);
      isRestoring = true;
      try {
        const ok = await selectModel(targetModel);
        if (ok) {
          await sleep(500); // let UI settle
        }
      } finally {
        isRestoring = false;
      }
    }
  }

  /**
   * Poll until a selector matches an element in the DOM.
   */
  function waitForElement(selector, timeoutMs) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }
      const deadline = Date.now() + timeoutMs;
      const interval = setInterval(() => {
        const found = document.querySelector(selector);
        if (found) {
          clearInterval(interval);
          resolve(found);
        } else if (Date.now() > deadline) {
          clearInterval(interval);
          resolve(null);
        }
      }, 300);
    });
  }

  /**
   * Listen for direct clicks on model-option buttons inside the dropdown.
   * Uses capture-phase event delegation so it works regardless of whether
   * Gemini stops propagation.  Only real user clicks reach here — the
   * programmatic `option.click()` in `selectModel()` is guarded by the
   * `isRestoring` flag.
   */
  function listenForOptionClicks() {
    document.addEventListener(
      "click",
      (e) => {
        if (isRestoring) return;
        const option = e.target.closest(MODE_OPTION_SEL);
        if (!option) return;
        const title = option.querySelector(".mode-title");
        if (!title) return;
        const model = title.textContent.trim();
        if (model) {
          log("User clicked model:", model);
          setPreferred(model);
        }
      },
      true, // capture phase
    );
  }

  // ── SPA navigation detection ─────────────────────────────────────────

  function watchNavigation() {
    // Listen for popstate (back/forward)
    window.addEventListener("popstate", () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        log("Navigation detected (popstate):", lastUrl);
        scheduleReinit();
      }
    });

    // Patch pushState/replaceState for programmatic navigations
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          log(`Navigation detected (${method}):`, lastUrl);
          scheduleReinit();
        }
        return result;
      };
    }

    // Observe body mutations – Gemini re-renders the main area on new chat.
    // We watch for URL changes that slip past pushState/replaceState.
    const bodyObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        log("Navigation detected (mutation):", lastUrl);
        scheduleReinit();
      }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  let reinitTimer = null;
  function scheduleReinit() {
    clearTimeout(reinitTimer);
    reinitTimer = setTimeout(() => init(), 800);
  }

  // ── Utilities ────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Test bridge (window.postMessage) ──────────────────────────────────
  // Allows E2E tests (running in the page's main world) to read/write
  // chrome.storage.local through the content script's isolated world.

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (isContextInvalidated()) return;
    const { type } = event.data || {};

    if (type === "__PBD_GET_STORAGE__") {
      const key = event.data.key;
      try {
        chrome.storage.local.get(key, (result) => {
          window.postMessage(
            { type: "__PBD_STORAGE_RESULT__", id: event.data.id, data: result },
            "*",
          );
        });
      } catch {
        // context gone – silently ignore
      }
    }

    if (type === "__PBD_CLEAR_STORAGE__") {
      try {
        chrome.storage.local.clear(() => {
          window.postMessage(
            { type: "__PBD_CLEAR_RESULT__", id: event.data.id },
            "*",
          );
        });
      } catch {
        // context gone – silently ignore
      }
    }
  });

  // ── Bootstrap ────────────────────────────────────────────────────────

  listenForOptionClicks();
  watchNavigation();
  init();
})();
