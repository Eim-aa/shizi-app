#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "audit", "vector-data-460-manifest.json");
const EXPECTED_ROUTE_COUNTS = {
  animcjk_363: 363,
  moe_stroke_svg_10: 10,
  human_generated_8: 8,
  strokeorder_merge_79: 79,
};

const ROUTES = [
  {
    id: "animcjk_363",
    receipt: "tmp/vector-mve/animcjk-363/production-import/receipt.json",
    select: (record) => true,
    sourcePath: (record) => record.candidate_path,
    sourceSha256: (record) => record.candidate_sha256,
  },
  {
    id: "moe_stroke_svg_10",
    receipt: "tmp/vector-mve/moe-stroke-svg-pilot/production-import/receipt.json",
    select: (record) => true,
    sourcePath: (record) => record.candidate_path,
    sourceSha256: (record) => record.candidate_sha256,
  },
  {
    id: "human_generated_8",
    receipt: "tmp/vector-mve/human-accepted-production-import/receipt.json",
    select: (record) => record.target_matches_approved_payload === true,
    sourcePath: (record) => record.source_path,
    sourceSha256: (record) => record.source_sha256,
  },
  {
    id: "strokeorder_merge_79",
    receipt: "tmp/vector-mve/strokeorder-production-import/receipt.json",
    select: (record) => true,
    sourcePath: (record) => record.source_path,
    sourceSha256: (record) => record.source_sha256,
  },
];

function check(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`);
  }
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function codepoint(character) {
  return `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validatePayload(character, payload, expectedStrokeCount) {
  check(payload && typeof payload === "object" && !Array.isArray(payload), "Data must be a JSON object", { character });
  check(JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(["medians", "strokes"]), "Data must contain only strokes and medians", { character, keys: Object.keys(payload) });
  check(Array.isArray(payload.strokes) && payload.strokes.length > 0, "Strokes must be a non-empty array", { character });
  check(Array.isArray(payload.medians), "Medians must be an array", { character });
  check(payload.strokes.length === payload.medians.length, "Stroke and median counts differ", { character, strokes: payload.strokes.length, medians: payload.medians.length });
  check(payload.strokes.length === expectedStrokeCount, "Stroke count differs from the approved normative count", { character, observed: payload.strokes.length, expected: expectedStrokeCount });

  payload.strokes.forEach((stroke, index) => {
    check(typeof stroke === "string" && stroke.trim().length > 0, "Stroke path must be a non-empty string", { character, index });
    check(/^[Mm]/.test(stroke.trim()), "Stroke path must begin with a move command", { character, index });
    check(!/[^MmLlHhVvCcSsQqTtAaZzEe0-9+.,\s-]/.test(stroke), "Stroke path contains an unsupported SVG path token", { character, index });
  });

  payload.medians.forEach((median, strokeIndex) => {
    check(Array.isArray(median) && median.length >= 2, "Each median must contain at least two points", { character, strokeIndex });
    median.forEach((point, pointIndex) => {
      check(Array.isArray(point) && point.length === 2 && point.every(Number.isFinite), "Median point must be a finite [x,y] pair", { character, strokeIndex, pointIndex });
    });
  });
}

function untrackedDataPaths() {
  const output = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", "data/*.json"], { cwd: ROOT });
  return output.toString("utf8").split("\0").filter(Boolean).sort();
}

function buildManifest() {
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).trim();
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  check(branch === "feat/library-governance", "Manifest must be generated on feat/library-governance", { branch });

  const records = [];
  const sourceReceipts = [];
  const characters = new Set();

  for (const route of ROUTES) {
    const receiptPath = path.join(ROOT, route.receipt);
    check(fs.existsSync(receiptPath), "Source receipt is missing", { path: route.receipt });
    const receipt = readJson(receiptPath);
    check(receipt.status === "APP_DATA_IMPORTED", "Source receipt is not an imported-data receipt", { path: route.receipt, status: receipt.status });
    check(receipt.question_bank_modified === false, "Source receipt says the question bank was modified", { path: route.receipt });
    const selected = receipt.records.filter(route.select);
    check(selected.length === EXPECTED_ROUTE_COUNTS[route.id], "Route count differs from the approved scope", { route: route.id, observed: selected.length, expected: EXPECTED_ROUTE_COUNTS[route.id] });

    sourceReceipts.push({
      route: route.id,
      path: route.receipt,
      sha256: sha256(receiptPath),
      status: receipt.status,
      selected_records: selected.length,
    });

    for (const sourceRecord of selected) {
      const character = sourceRecord.character;
      check(Array.from(character).length === 1, "Record character must be one Unicode scalar", { route: route.id, character });
      check(!characters.has(character), "Approved routes overlap", { character, route: route.id });
      characters.add(character);

      const dataPath = `data/${character}.json`;
      const absoluteDataPath = path.join(ROOT, dataPath);
      check(sourceRecord.target_path === dataPath, "Receipt target path differs from the production path", { character, route: route.id, receiptTarget: sourceRecord.target_path, dataPath });
      check(fs.existsSync(absoluteDataPath), "Production data file is missing", { character, dataPath });
      check(sha256(absoluteDataPath) === sourceRecord.target_sha256, "Production data hash differs from its import receipt", { character, route: route.id });

      const payload = readJson(absoluteDataPath);
      const normativeStrokeCount = Number(sourceRecord.normative_stroke_count);
      check(Number.isInteger(normativeStrokeCount) && normativeStrokeCount > 0, "Receipt has no valid normative stroke count", { character, route: route.id });
      validatePayload(character, payload, normativeStrokeCount);

      records.push({
        character,
        codepoint: codepoint(character),
        route: route.id,
        data_path: dataPath,
        data_sha256: sha256(absoluteDataPath),
        byte_size: fs.statSync(absoluteDataPath).size,
        normative_stroke_count: normativeStrokeCount,
        stroke_count: payload.strokes.length,
        median_count: payload.medians.length,
        source_path: route.sourcePath(sourceRecord),
        source_sha256: route.sourceSha256(sourceRecord),
        acceptance_path: sourceRecord.acceptance_path || receipt.acceptance_path || null,
      });
    }
  }

  records.sort((left, right) => left.character.codePointAt(0) - right.character.codePointAt(0));
  check(records.length === 460 && characters.size === 460, "Approved union must contain exactly 460 unique characters", { records: records.length, unique: characters.size });

  const expectedUntracked = records.map((record) => record.data_path).sort();
  const observedUntracked = untrackedDataPaths();
  check(JSON.stringify(observedUntracked) === JSON.stringify(expectedUntracked), "Untracked production data files differ from the approved 460-file scope", { observed: observedUntracked.length, expected: expectedUntracked.length });

  const progressPath = path.join(ROOT, "tmp", "vector-mve", "current-goal-progress.json");
  const progress = readJson(progressPath);
  check(progress.target_count === 1251, "Frozen target count changed", { observed: progress.target_count });
  check(progress.app_data_files_present_for_target === 460, "Progress receipt does not report 460 present files", { observed: progress.app_data_files_present_for_target });
  check(progress.app_data_files_still_missing_for_target === 791, "Progress receipt does not report 791 deferred files", { observed: progress.app_data_files_still_missing_for_target });

  return {
    schema_version: 1,
    artifact: "shizi-vector-data-460-final-manifest",
    created_at_utc: new Date().toISOString(),
    source_worktree: {
      branch,
      base_commit: head,
    },
    scope: {
      original_target_count: 1251,
      accepted_completed_count: 460,
      intentionally_deferred_count: 791,
      question_bank_modified: false,
      main_branch_modified: false,
    },
    counts: {
      records: records.length,
      unique_characters: characters.size,
      routes: EXPECTED_ROUTE_COUNTS,
    },
    gates: {
      exact_approved_union: true,
      receipt_target_hash_match: true,
      json_parse: true,
      exact_strokes_and_medians_keys: true,
      stroke_median_count_match: true,
      normative_stroke_count_match: true,
      finite_median_coordinates: true,
      browser_svg_render_gate: "verified by scripts/verify_vector_data_460.js",
    },
    source_receipts: sourceReceipts,
    records,
  };
}

function validateManifestStatic(manifest) {
  check(manifest.schema_version === 1 && manifest.artifact === "shizi-vector-data-460-final-manifest", "Unexpected manifest schema or artifact name");
  check(manifest.scope.accepted_completed_count === 460 && manifest.scope.intentionally_deferred_count === 791, "Manifest scope is not 460 completed / 791 deferred");
  check(manifest.scope.question_bank_modified === false && manifest.scope.main_branch_modified === false, "Manifest scope unexpectedly modifies the question bank or main branch");
  check(manifest.counts.records === 460 && manifest.records.length === 460, "Manifest must contain 460 records");
  check(JSON.stringify(manifest.counts.routes) === JSON.stringify(EXPECTED_ROUTE_COUNTS), "Manifest route counts changed");

  const characters = new Set();
  const routes = Object.fromEntries(Object.keys(EXPECTED_ROUTE_COUNTS).map((route) => [route, 0]));
  for (const record of manifest.records) {
    check(!characters.has(record.character), "Manifest contains a duplicate character", { character: record.character });
    characters.add(record.character);
    check(routes[record.route] !== undefined, "Manifest contains an unknown route", { character: record.character, route: record.route });
    routes[record.route] += 1;
    check(record.data_path === `data/${record.character}.json`, "Manifest data path does not match its character", { character: record.character, path: record.data_path });
    const dataPath = path.join(ROOT, record.data_path);
    check(fs.existsSync(dataPath), "Manifest data file is missing", { character: record.character, path: record.data_path });
    check(sha256(dataPath) === record.data_sha256, "Manifest data hash mismatch", { character: record.character });
    check(fs.statSync(dataPath).size === record.byte_size, "Manifest byte size mismatch", { character: record.character });
    const payload = readJson(dataPath);
    validatePayload(record.character, payload, record.normative_stroke_count);
    check(payload.strokes.length === record.stroke_count && payload.medians.length === record.median_count, "Manifest payload counts changed", { character: record.character });
  }
  check(characters.size === 460, "Manifest unique-character count changed", { observed: characters.size });
  check(JSON.stringify(routes) === JSON.stringify(EXPECTED_ROUTE_COUNTS), "Observed route counts differ from the frozen route counts", { observed: routes });
  return { manifest, characters };
}

async function validateBrowserPaths(manifest) {
  const { chromium } = require("playwright");
  const executablePath = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find(fs.existsSync);
  check(executablePath, "No Chrome or Chromium executable is available for the SVG render gate");

  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end('<!doctype html><meta charset="utf-8"><svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg>');
        return;
      }
      const filePath = path.resolve(ROOT, `.${pathname}`);
      check(filePath.startsWith(`${ROOT}${path.sep}`), "HTTP render gate rejected an out-of-root path", { pathname });
      const fileContents = fs.readFileSync(filePath);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(fileContents);
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error.message || error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  check(address && typeof address === "object", "Local render-gate server did not start");

  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const chunkSize = 20;
    for (let offset = 0; offset < manifest.records.length; offset += chunkSize) {
      const chunk = manifest.records.slice(offset, offset + chunkSize).map((record) => ({
        character: record.character,
        expectedStrokeCount: record.stroke_count,
      }));
      const failures = await page.evaluate(async (rows) => {
        const svg = document.getElementById("canvas");
        const failures = [];
        for (const row of rows) {
          let payload;
          try {
            const response = await fetch(`data/${encodeURIComponent(row.character)}.json`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            payload = await response.json();
            if (!Array.isArray(payload.strokes) || payload.strokes.length !== row.expectedStrokeCount) {
              throw new Error(`unexpected stroke count ${payload.strokes?.length}`);
            }
          } catch (error) {
            failures.push({ character: row.character, fetch_error: String(error) });
            continue;
          }
          payload.strokes.forEach((stroke, index) => {
            try {
              const element = document.createElementNS("http://www.w3.org/2000/svg", "path");
              element.setAttribute("d", stroke);
              svg.appendChild(element);
              const length = element.getTotalLength();
              const box = element.getBBox();
              const values = [length, box.x, box.y, box.width, box.height];
              if (!values.every(Number.isFinite) || length <= 0 || box.width + box.height <= 0) {
                failures.push({ character: row.character, index, length, box: [box.x, box.y, box.width, box.height] });
              }
              element.remove();
            } catch (error) {
              failures.push({ character: row.character, index, error: String(error) });
            }
          });
        }
        return failures;
      }, chunk);
      check(failures.length === 0, "Browser SVG render gate failed", failures.slice(0, 10));
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const writeManifest = process.argv.includes("--write-manifest");
  if (writeManifest) {
    const manifest = buildManifest();
    fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  check(fs.existsSync(MANIFEST_PATH), "Final manifest is missing; run with --write-manifest first", { path: relative(MANIFEST_PATH) });
  const manifest = readJson(MANIFEST_PATH);
  validateManifestStatic(manifest);
  await validateBrowserPaths(manifest);
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    manifest: relative(MANIFEST_PATH),
    manifest_sha256: sha256(MANIFEST_PATH),
    verified_characters: manifest.records.length,
    route_counts: manifest.counts.routes,
    static_gates: "PASS",
    browser_svg_render_gate: "PASS_ALL_STROKES",
    question_bank_modified: false,
    main_branch_modified: false,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
