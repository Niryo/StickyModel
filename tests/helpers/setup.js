/**
 * E2E test setup helper.
 *
 * Launches a headed Chrome instance with:
 *   - The Pro By Default extension loaded
 *   - A persistent user-data-dir so Google auth survives across runs
 *
 * Navigates to gemini.google.com and waits for the user to be
 * authenticated. The model picker dropdown is visible without login,
 * but the options are grayed out and non-functional until signed in.
 *
 * On the first ever run the user must log in manually in the browser
 * window. Subsequent runs reuse the saved session automatically.
 */

import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const PROFILE_DIR = path.join(PROJECT_ROOT, "tests", ".chrome-profile");
export const GEMINI_URL = "https://gemini.google.com/app";

// How long to wait for the user to log in on the first run.
const AUTH_TIMEOUT_MS = 120_000;
// Quick check before prompting the user.
const QUICK_CHECK_MS = 8_000;

/**
 * Launch Chrome with the extension and return { context, page }.
 * The caller is responsible for closing the context when done.
 */
export async function launchBrowser() {
  // Clean up stale lock file if a previous run was killed
  const lockFile = path.join(PROFILE_DIR, "SingletonLock");
  try {
    fs.unlinkSync(lockFile);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${PROJECT_ROOT}`,
      `--load-extension=${PROJECT_ROOT}`,
      // Avoid "Chrome is being controlled by automated test software" bar
      // taking up space, but don't fully hide it.
      "--disable-infobars",
    ],
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--disable-extensions"],
  });

  // Use the first page if one was opened automatically, otherwise create one.
  const page =
    context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  return { context, page };
}

/**
 * Navigate to Gemini and wait for the user to be authenticated.
 * On first run, prints instructions to the console and waits up to 120 s.
 * Subsequent runs reuse the persistent profile and proceed immediately.
 */
export async function navigateAndWaitForAuth(page) {
  await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });

  // Wait for the page to render the model picker
  const ready = await waitForPicker(page, QUICK_CHECK_MS);
  if (!ready) {
    console.log("[setup] Waiting for Gemini page to load...");
    const ok = await waitForPicker(page, AUTH_TIMEOUT_MS);
    if (!ok) {
      throw new Error(
        "Gemini page did not load within the timeout. " +
          "Check your network connection and re-run.",
      );
    }
  }

  // The dropdown is visible without login, but the options are grayed out
  // and not clickable — sign-in is required for them to work.
  const signedIn = await isSignedIn(page);
  if (signedIn) {
    console.log("[setup] Signed in. Model picker functional.");
    return;
  }

  // Not signed in – prompt the user
  console.log(
    "\n╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║  Please log in to Google in the browser window.            ║",
  );
  console.log(
    "║  The model picker is visible but options are grayed out    ║",
  );
  console.log(
    "║  until you sign in.                                        ║",
  );
  console.log(
    "║  Tests will continue automatically once you're signed in.  ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝\n",
  );

  const deadline = Date.now() + AUTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // The user might navigate away to sign in; wait for them to come back
    const onGemini = page.url().includes("gemini.google.com");
    if (onGemini && (await isSignedIn(page))) {
      console.log("[setup] Sign-in detected. Continuing tests.");
      return;
    }
    await page.waitForTimeout(2000);
  }

  throw new Error(
    `Sign-in timed out after ${AUTH_TIMEOUT_MS / 1000}s. ` +
      "Please log in and re-run the tests.",
  );
}

/**
 * Poll the page until the model picker label is visible with text content.
 */
async function waitForPicker(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = await page.evaluate(() => {
      const pickerLabel = document.querySelector(
        '[data-test-id="logo-pill-label-container"]',
      );
      return pickerLabel && pickerLabel.textContent.trim().length > 0;
    });

    if (found) return true;
    await page.waitForTimeout(1000);
  }

  return false;
}

/**
 * Check if the user is signed in by looking for the header sign-in link.
 * When signed in, Google replaces it with a user avatar.
 */
async function isSignedIn(page) {
  return page.evaluate(() => {
    const signInLinks = document.querySelectorAll('a[aria-label="Sign in"]');
    for (const link of signInLinks) {
      const rect = link.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return false;
    }
    // Also check that the picker label exists (page is loaded)
    const label = document.querySelector(
      '[data-test-id="logo-pill-label-container"]',
    );
    return !!(label && label.textContent.trim());
  });
}

