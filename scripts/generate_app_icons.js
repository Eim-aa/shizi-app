#!/usr/bin/env node
"use strict";

// Render each target independently from the SVG with 4x supersampling for smooth edges.
// Reuses the project's existing Playwright dependency.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const BRANDING = path.join(ROOT, "assets/branding");
const SOURCES = {
  light: "app-icon-source.svg",
  small: "app-icon-source-small.svg", // 87px and below: heavier strokes stay legible
  dark: "app-icon-dark.svg",
  tinted: "app-icon-tinted.svg",
  maskable: "app-icon-maskable.svg",
};
const SMALL_MAX = 87;
const CATALOG = path.join(ROOT, "ios/ShiziApp/ShiziApp/Assets.xcassets/AppIcon.appiconset");

async function main() {
  const svgs = Object.fromEntries(Object.entries(SOURCES).map(([key, file]) => [key, fs.readFileSync(path.join(BRANDING, file), "utf8")]));
  const pick = size => (size <= SMALL_MAX ? "small" : "light");
  // file -> { source, size }
  const outputs = new Map([180, 192, 512].map(size => [path.join(ROOT, `icon-${size}.png`), { source: pick(size), size }]));
  outputs.set(path.join(ROOT, "icon-512-maskable.png"), { source: "maskable", size: 512 });
  const catalog = JSON.parse(fs.readFileSync(path.join(CATALOG, "Contents.json"), "utf8"));
  for (const entry of catalog.images) {
    if (!entry.filename) continue;
    const [width, height] = entry.size.split("x").map(Number);
    const scale = entry.scale || "1x";
    const pixels = width * Number(scale.replace(/x$/, ""));
    if (width !== height || !Number.isInteger(pixels) || pixels <= 0) {
      throw new Error(`Unsupported app icon size: ${entry.size} @ ${scale}`);
    }
    const appearance = (entry.appearances || []).find(item => item.appearance === "luminosity");
    const source = appearance ? appearance.value : pick(pixels);
    if (!svgs[source]) throw new Error(`No SVG source for appearance: ${source}`);
    outputs.set(path.join(CATALOG, entry.filename), { source, size: pixels });
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
    const renders = new Map();
    const jobs = new Map([...outputs.values()].map(job => [`${job.source}@${job.size}`, job]));
    for (const [key, { source: sourceKey, size }] of jobs) {
      const source = svgs[sourceKey];
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
      }, { source, size });
      // A page capture produces RGB PNGs; canvas.toDataURL retains an alpha channel
      // even for an opaque context, which is unsuitable for App Store artwork.
      renders.set(key, await page.screenshot({ type: "png", omitBackground: false, animations: "disabled" }));
    }
    // Finish all renders before replacing any checked-in output.
    for (const [file, job] of outputs) fs.writeFileSync(file, renders.get(`${job.source}@${job.size}`));
    console.log(`Exported ${outputs.size} PNG icons from ${Object.keys(SOURCES).length} SVG sources in ${path.relative(ROOT, BRANDING)}.`);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
