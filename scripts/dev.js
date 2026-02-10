#!/usr/bin/env node
// Dev build – copies source files to dist/ without minification for easy
// debugging.  Re-run after changes, then hit the refresh button on
// chrome://extensions to pick up the new code.

import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");

const JS_FILES = ["content.js", "background.js"];
const STATIC_ASSETS = ["manifest.json", "icons"];

async function clean() {
  if (existsSync(DIST)) await rm(DIST, { recursive: true });
  await mkdir(DIST, { recursive: true });
}

async function copyJS() {
  for (const file of JS_FILES) {
    const src = await readFile(join(ROOT, file), "utf-8");
    await writeFile(join(DIST, file), src, "utf-8");
    console.log(`  ✓ ${file}`);
  }
}

async function copyStatic() {
  for (const asset of STATIC_ASSETS) {
    await cp(join(ROOT, asset), join(DIST, asset), { recursive: true });
    console.log(`  ✓ ${asset}`);
  }
}

console.log("\n🔧 Dev build → dist/\n");

await clean();

console.log("Copying JS (unminified)...");
await copyJS();

console.log("Copying static assets...");
await copyStatic();

console.log("\n✅ Dev build complete!");
console.log("   Load dist/ as an unpacked extension in chrome://extensions\n");
