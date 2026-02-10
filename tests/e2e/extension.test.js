/**
 * E2E tests for the Sticky Model Chrome extension.
 *
 * Tests run against the real gemini.google.com in a headed Chrome instance
 * with the extension loaded. A persistent Chrome profile is used so that
 * Google authentication survives across test runs — you only need to log
 * in once.
 *
 * The single browser instance is shared across all test cases
 * (launched in beforeAll, closed in afterAll).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  launchBrowser,
  navigateAndWaitForAuth,
  GEMINI_URL,
} from "../helpers/setup.js";

let context;
let page;

// ── Selectors (must match content.js) ────────────────────────────────────

const PICKER_BUTTON_SEL = '[data-test-id="bard-mode-menu-button"]';
const PICKER_LABEL_SEL = '[data-test-id="logo-pill-label-container"]';
const MODE_OPTION_SEL =
  'button[role="menuitemradio"][data-test-id^="bard-mode-option-"]';

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Read the model picker label text (e.g. "Fast", "Pro", "Thinking").
 */
async function getModelLabel() {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.trim() : null;
  }, PICKER_LABEL_SEL);
}

/**
 * Click the model picker button to open the dropdown, then click the
 * target model option. Uses page.evaluate for clicks to avoid Playwright
 * hanging on Angular navigation/overlay triggers.
 */
async function selectModel(name) {
  const target = name.toLowerCase().trim();

  // Open the dropdown
  await page.evaluate((sel) => {
    document.querySelector(sel)?.click();
  }, PICKER_BUTTON_SEL);

  // Wait for options to appear
  await page.waitForSelector(MODE_OPTION_SEL, { timeout: 5000 });

  // Click the matching option
  const clicked = await page.evaluate(
    ({ sel, target }) => {
      const options = document.querySelectorAll(sel);
      for (const opt of options) {
        const title = opt.querySelector(".mode-title");
        if (title && title.textContent.trim().toLowerCase() === target) {
          opt.click();
          return true;
        }
      }
      return false;
    },
    { sel: MODE_OPTION_SEL, target },
  );

  // Wait for UI to settle and content script to observe the change
  await page.waitForTimeout(1500);
  return clicked;
}

/**
 * Read a key from chrome.storage.local via the content script's
 * window.postMessage bridge.
 */
async function getStorageValue(key) {
  return page.evaluate(
    async (key) => {
      const id = Math.random().toString(36).slice(2);
      return new Promise((resolve) => {
        const handler = (event) => {
          if (
            event.data?.type === "__PBD_STORAGE_RESULT__" &&
            event.data?.id === id
          ) {
            window.removeEventListener("message", handler);
            resolve(event.data.data[key] ?? null);
          }
        };
        window.addEventListener("message", handler);
        window.postMessage(
          { type: "__PBD_GET_STORAGE__", key, id },
          "*",
        );
      });
    },
    key,
  );
}

/**
 * Clear chrome.storage.local via the content script's
 * window.postMessage bridge.
 */
async function clearStorage() {
  return page.evaluate(async () => {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      const handler = (event) => {
        if (
          event.data?.type === "__PBD_CLEAR_RESULT__" &&
          event.data?.id === id
        ) {
          window.removeEventListener("message", handler);
          resolve();
        }
      };
      window.addEventListener("message", handler);
      window.postMessage({ type: "__PBD_CLEAR_STORAGE__", id }, "*");
    });
  });
}

/**
 * Click the "New chat" button.
 */
async function clickNewChat() {
  // The new-chat button is in the sidebar or header.
  const clicked = await page.evaluate(() => {
    const candidates = document.querySelectorAll(
      'button, [role="button"], a',
    );
    for (const el of candidates) {
      const text = (el.textContent || "").toLowerCase().trim();
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      if (
        text === "new chat" ||
        label.includes("new chat") ||
        text.includes("new chat")
      ) {
        el.click();
        return true;
      }
    }
    return false;
  });
  // Wait for SPA navigation and content script re-init
  await page.waitForTimeout(3000);
  return clicked;
}

/**
 * Wait until the picker label shows a specific model name.
 */
async function waitForModelLabel(name, timeoutMs = 10000) {
  const target = name.toLowerCase().trim();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const label = await getModelLabel();
    if (label && label.toLowerCase().trim() === target) return label;
    await page.waitForTimeout(500);
  }
  // Return whatever the label shows now (for diagnostics)
  return getModelLabel();
}

/**
 * Clear storage and reload the page so Gemini loads without any
 * extension-stored preference.  After reload, verify that Gemini
 * resets the model back to its default ("fast").
 *
 * Returns the model label after reload.
 *
 * If Gemini did NOT reset to "fast", a warning is logged — this
 * means Gemini may have changed its behaviour and the extension
 * might no longer be necessary.
 */
async function reloadWithCleanState() {
  await clearStorage();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const label = await getModelLabel();
  if (label && label.toLowerCase() !== "fast") {
    console.warn(
      `⚠ Gemini did not reset model to "fast" after reload (got "${label}"). ` +
        `Gemini may no longer reset the selection — the extension might not be needed.`,
    );
  }
  return label;
}

// ── Setup / Teardown ─────────────────────────────────────────────────────

beforeAll(async () => {
  const result = await launchBrowser();
  context = result.context;
  page = result.page;
  await navigateAndWaitForAuth(page);
}, 130_000);

afterAll(async () => {
  if (context) {
    await context.close();
  }
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("Sticky Model extension", () => {
  beforeEach(async () => {
    // Navigate to Gemini home (new chat state) before each test
    await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000); // wait for SPA render + content script init
  });

  it("1. detects the model selector on the page", async () => {
    const label = await getModelLabel();
    console.log("  → Picker label:", label);
    expect(label).not.toBeNull();
    expect(label.length).toBeGreaterThan(0);
  });

  it("2. persists an explicit model change to storage", async (ctx) => {
    const initial = await reloadWithCleanState();
    if (initial?.toLowerCase() !== "fast") {
      console.warn("  → Skipping: Gemini didn't reset to default model");
      ctx.skip();
      return;
    }

    // Switch to a different model
    await selectModel("thinking");

    // Give the content script time to observe + persist
    await page.waitForTimeout(2000);

    const label = await getModelLabel();
    console.log("  → Label after selection:", label);

    const stored = await getStorageValue("preferredModel");
    console.log("  → Stored preference:", stored);
    expect(stored).not.toBeNull();
    expect(stored.toLowerCase()).toBe("thinking");
  });

  it("3. restores the model after clicking New Chat", async (ctx) => {
    const initial = await reloadWithCleanState();
    if (initial?.toLowerCase() !== "fast") {
      console.warn("  → Skipping: Gemini didn't reset to default model");
      ctx.skip();
      return;
    }

    await selectModel("thinking");
    await page.waitForTimeout(2000);

    const stored = await getStorageValue("preferredModel");
    expect(stored?.toLowerCase()).toBe("thinking");

    // Click "New chat" — Gemini resets to default, extension should restore
    const chatClicked = await clickNewChat();
    if (!chatClicked) {
      // If there's no "New chat" button, navigate instead
      await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
    }

    // The content script should restore "Thinking"
    const restored = await waitForModelLabel("thinking", 10000);
    console.log("  → Model after new chat:", restored);
    expect(restored?.toLowerCase()).toBe("thinking");
  });

  it("4. restores the model after a full page reload", async (ctx) => {
    const initial = await reloadWithCleanState();
    if (initial?.toLowerCase() !== "fast") {
      console.warn("  → Skipping: Gemini didn't reset to default model");
      ctx.skip();
      return;
    }

    await selectModel("thinking");
    await page.waitForTimeout(2000);

    // Full page reload — Gemini resets to default, extension should restore
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const restored = await waitForModelLabel("thinking", 10000);
    console.log("  → Model after reload:", restored);
    expect(restored?.toLowerCase()).toBe("thinking");
  });

  it("5. updates the stored preference when user picks a different model", async (ctx) => {
    const initial = await reloadWithCleanState();
    if (initial?.toLowerCase() !== "fast") {
      console.warn("  → Skipping: Gemini didn't reset to default model");
      ctx.skip();
      return;
    }

    await selectModel("thinking");
    await page.waitForTimeout(2000);

    let stored = await getStorageValue("preferredModel");
    expect(stored?.toLowerCase()).toBe("thinking");

    // Now switch to "Fast" explicitly
    await selectModel("fast");
    await page.waitForTimeout(2000);

    stored = await getStorageValue("preferredModel");
    console.log("  → Updated preference:", stored);
    expect(stored?.toLowerCase()).toBe("fast");
  });

  it("6. does not overwrite storage during programmatic restore", async (ctx) => {
    const initial = await reloadWithCleanState();
    if (initial?.toLowerCase() !== "fast") {
      console.warn("  → Skipping: Gemini didn't reset to default model");
      ctx.skip();
      return;
    }

    await selectModel("thinking");
    await page.waitForTimeout(2000);

    let stored = await getStorageValue("preferredModel");
    expect(stored?.toLowerCase()).toBe("thinking");

    // Navigate to new chat (triggers default reset + restore)
    await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    // Storage should still say "Thinking", not the default
    stored = await getStorageValue("preferredModel");
    console.log("  → Storage after restore:", stored);
    expect(stored?.toLowerCase()).toBe("thinking");
  });

  it("7. defaults to Pro when no preference is stored (fresh install)", async () => {
    await clearStorage();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Should switch to "Pro" as the default model
    const label = await waitForModelLabel("pro", 10000);
    console.log("  → Model with no preference:", label);
    expect(label?.toLowerCase()).toBe("pro");
  });
});
