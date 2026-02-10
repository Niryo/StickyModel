#!/usr/bin/env node
// Build script – minifies JS sources and packages the extension into a zip.

import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createWriteStream } from "node:fs";
import { minify } from "terser";
import archiver from "archiver";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const ZIP_DIR = join(ROOT, "build");

// Files to minify
const JS_FILES = ["content.js", "background.js"];

// Files/dirs to copy as-is
const STATIC_ASSETS = ["manifest.json", "icons"];

async function clean() {
  for (const dir of [DIST, ZIP_DIR]) {
    if (existsSync(dir)) await rm(dir, { recursive: true });
  }
  await mkdir(DIST, { recursive: true });
  await mkdir(ZIP_DIR, { recursive: true });
}

async function minifyJS() {
  for (const file of JS_FILES) {
    const src = await readFile(join(ROOT, file), "utf-8");
    const result = await minify(src, {
      compress: { drop_console: false, passes: 2 },
      mangle: true,
      format: { comments: false },
    });
    await writeFile(join(DIST, file), result.code, "utf-8");
    const savings = ((1 - result.code.length / src.length) * 100).toFixed(1);
    console.log(`  ✓ ${file}  (${savings}% smaller)`);
  }
}

async function copyStatic() {
  for (const asset of STATIC_ASSETS) {
    const src = join(ROOT, asset);
    const dest = join(DIST, asset);
    await cp(src, dest, { recursive: true });
    console.log(`  ✓ ${asset}`);
  }
}

/** Read the version from manifest.json. */
async function getVersion() {
  const manifest = JSON.parse(
    await readFile(join(ROOT, "manifest.json"), "utf-8"),
  );
  return manifest.version;
}

function createZip(version) {
  return new Promise((resolve, reject) => {
    const zipName = `sticky-model-v${version}.zip`;
    const zipPath = join(ZIP_DIR, zipName);
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      const sizeKB = (archive.pointer() / 1024).toFixed(1);
      console.log(`  ✓ ${zipName}  (${sizeKB} KB)`);
      resolve(zipPath);
    });

    archive.on("error", reject);
    archive.pipe(output);

    // Add entire dist/ contents at the root of the zip
    archive.directory(DIST, false);
    archive.finalize();
  });
}

// ── Main ────────────────────────────────────────────────────────────────

console.log("\n🔨 Building Sticky Model extension\n");

console.log("Cleaning...");
await clean();

console.log("Minifying JS...");
await minifyJS();

console.log("Copying static assets...");
await copyStatic();

const version = await getVersion();
console.log(`Packaging zip (v${version})...`);
const zipPath = await createZip(version);

console.log(`\n✅ Build complete! Zip: ${zipPath}\n`);
