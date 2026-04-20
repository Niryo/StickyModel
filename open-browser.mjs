import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const PROJECT_ROOT = "/Users/niryo/git/ProByDefault";
const PROFILE_DIR = path.join(PROJECT_ROOT, "tests", ".chrome-profile");

const lockFile = path.join(PROFILE_DIR, "SingletonLock");
try { fs.unlinkSync(lockFile); } catch {}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [
    `--disable-extensions-except=${PROJECT_ROOT}`,
    `--load-extension=${PROJECT_ROOT}`,
    "--disable-infobars",
  ],
  viewport: { width: 1280, height: 900 },
  ignoreDefaultArgs: ["--disable-extensions"],
});

const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });

console.log("Browser open. Press Ctrl+C to close.");
await new Promise(() => {}); // keep alive
