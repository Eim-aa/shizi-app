#!/usr/bin/env node
"use strict";

// Render each target independently from the SVG with 4x supersampling for smooth edges.
// Reuses the project's existing Playwright dependency.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "assets/branding/app-icon-source.svg");
const CATALOG = path.join(ROOT, "ios/ShiziApp/ShiziApp/Assets.xcassets/AppIcon.appiconset");

async function main() {
  const svg = fs.readFileSync(SOURCE, "utf8");
  const outputs = new Map([180, 192, 512].map(size => [path.join(ROOT, `icon-${size}.png`), size]));
  const catalog = JSON.parse(fs.readFileSync(path.join(CATALOG, "Contents.json"), "utf8"));
  for (const entry of catalog.images) {
    if (!entry.filename) continue;
    const [width, height] = entry.size.split("x").map(Number);
    const pixels = width * Number(entry.scale.replace(/x$/, ""));
    if (width !== height || !Number.isInteger(pixels) || pixels <= 0) {
      throw new Error(`Unsupported app icon size: ${entry.size} @ ${entry.scale}`);
    }
    outputs.set(path.join(CATALOG, entry.filename), pixels);
  }

  const executablePath = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, args: ["--disable-gpu"], ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent("<!doctype html><style>html,body{margin:0;overflow:hidden}canvas{display:block}</style><body></body>");
    const bySize = new Map();
    for (const size of new Set(outputs.values())) {
      await page.setViewportSize({ width: size, height: size });
      await page.evaluate(async ({ source, size }) => {
        const svgDocument = new DOMParser().parseFromString(source, "image/svg+xml");
        const scale = 4;
        svgDocument.documentElement.setAttribute("width", size * scale);
        svgDocument.documentElement.setAttribute("height", size * scale);
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svgDocument)], { type: "image/svg+xml" }));
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const large = document.createElement("canvas");
          large.width = large.height = size * scale;
          large.getContext("2d", { alpha: false }).drawImage(image, 0, 0, large.width, large.height);
          const output = document.createElement("canvas");
          output.width = output.height = size;
          const context = output.getContext("2d", { alpha: false });
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(large, 0, 0, size, size);
          document.body.replaceChildren(output);
        } finally {
          URL.revokeObjectURL(url);
        }
      }, { source: svg, size });
      // A page capture produces RGB PNGs; canvas.toDataURL retains an alpha channel
      // even for an opaque context, which is unsuitable for App Store artwork.
      bySize.set(size, await page.screenshot({ type: "png", omitBackground: false, animations: "disabled" }));
    }
    // Finish all renders before replacing any checked-in output.
    for (const [file, size] of outputs) fs.writeFileSync(file, bySize.get(size));
    console.log(`Exported ${outputs.size} PNG icons from ${path.relative(ROOT, SOURCE)}.`);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
