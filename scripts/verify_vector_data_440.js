#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "audit/vector-data-460-manifest.json");
const INDEX_PATH = path.join(ROOT, "audit/vector-data-460-evidence-index.json");
const RECORDS_PATH = path.join(ROOT, "audit/vector-data-460-evidence/records.json");
const ROUTES_PATH = path.join(ROOT, "audit/vector-data-460-evidence/route-evidence.json");
const CLOSURE_PATH = path.join(ROOT, "audit/vector-data-460-evidence/review-decisions/strokeorder-49-scope-closure.json");
const RECEIPT_PATH = path.join(ROOT, "audit/vector-data-460-evidence/imports/finalize-440.json");
const EXPECTED_ROUTE_COUNTS = { animcjk_363: 363, moe_stroke_svg_10: 10, human_generated_8: 8, strokeorder_merge_79: 59 };

function check(value, message, details) {
  if (!value) throw new Error(`${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`);
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectAbsoluteLocalPaths(value, jsonPath = "$") {
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\", "/");
    return /^\/(?!\/)|^[A-Za-z]:\/|^file:\/\/\//i.test(normalized) ? [{ jsonPath, value }] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => collectAbsoluteLocalPaths(item, `${jsonPath}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => collectAbsoluteLocalPaths(item, `${jsonPath}.${key}`));
  return [];
}

function validatePortableAuditJson(filePath) {
  const offenders = collectAbsoluteLocalPaths(readJson(filePath));
  check(offenders.length === 0, "Audit JSON contains a machine-local absolute path", { path: relative(filePath), offenders: offenders.slice(0, 10) });
}

function validatePayload(character, payload, expectedCount) {
  check(payload && typeof payload === "object" && !Array.isArray(payload), "Payload is not an object", { character });
  check(JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(["medians", "strokes"]), "Payload keys changed", { character });
  check(Array.isArray(payload.strokes) && Array.isArray(payload.medians), "Payload arrays missing", { character });
  check(payload.strokes.length === payload.medians.length && payload.strokes.length === expectedCount, "Payload stroke count mismatch", { character, expectedCount, strokes: payload.strokes.length, medians: payload.medians.length });
  payload.strokes.forEach((stroke, index) => {
    check(typeof stroke === "string" && /^[Mm]/.test(stroke.trim()), "Malformed SVG path", { character, index });
    check(!/[^MmLlHhVvCcSsQqTtAaZzEe0-9+.,\s-]/.test(stroke), "Unsupported SVG token", { character, index });
  });
  payload.medians.forEach((median, strokeIndex) => {
    check(Array.isArray(median) && median.length >= 2, "Median is too short", { character, strokeIndex });
    check(median.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)), "Median contains a non-finite point", { character, strokeIndex });
  });
}

function validateManifest() {
  validatePortableAuditJson(MANIFEST_PATH);
  const manifest = readJson(MANIFEST_PATH);
  check(manifest.schema_version === 2 && manifest.artifact === "shizi-vector-data-440-technical-manifest", "Unexpected final manifest artifact");
  check(manifest.audit_state === "TECHNICAL_AND_HUMAN_REVIEW_PASS_440", "Final audit state changed", { audit_state: manifest.audit_state });
  check(
    manifest.scope.technically_validated_count === 440
      && manifest.scope.human_accepted_count === 440
      && manifest.scope.human_review_pending_count === 0
      && manifest.scope.intentionally_deferred_count === 811,
    "Final manifest scope changed",
    manifest.scope,
  );
  check(manifest.counts.records === 440 && manifest.records.length === 440 && manifest.counts.unique_characters === 440, "Final manifest count changed");
  check(JSON.stringify(manifest.counts.routes) === JSON.stringify(EXPECTED_ROUTE_COUNTS), "Final route counts changed", manifest.counts.routes);
  check(manifest.gates.human_review_gate === "440 accepted; 0 pending", "Final human-review gate changed");
  check(manifest.clean_clone_evidence.index_path === "audit/vector-data-460-evidence-index.json" && sha256(INDEX_PATH) === manifest.clean_clone_evidence.index_sha256, "Evidence-index binding mismatch");

  const characters = new Set();
  const routes = Object.fromEntries(Object.keys(EXPECTED_ROUTE_COUNTS).map(route => [route, 0]));
  let strokeTotal = 0;
  for (const record of manifest.records) {
    check(!characters.has(record.character), "Duplicate manifest character", { character: record.character });
    characters.add(record.character);
    check(routes[record.route] !== undefined, "Unknown final route", { character: record.character, route: record.route });
    routes[record.route] += 1;
    check(record.human_review_status === "HUMAN_ACCEPTED" && typeof record.acceptance_path === "string", "Final record is not human accepted", { character: record.character });
    check(record.data_path === `data/${record.character}.json`, "Data path/character mismatch", { character: record.character });
    const dataPath = path.join(ROOT, record.data_path);
    check(fs.existsSync(dataPath) && sha256(dataPath) === record.data_sha256 && fs.statSync(dataPath).size === record.byte_size, "Final data binding mismatch", { character: record.character });
    const payload = readJson(dataPath);
    validatePayload(record.character, payload, record.normative_stroke_count);
    check(payload.strokes.length === record.stroke_count && payload.medians.length === record.median_count, "Manifest payload counts differ", { character: record.character });
    strokeTotal += record.stroke_count;
  }
  check(characters.size === 440 && JSON.stringify(routes) === JSON.stringify(EXPECTED_ROUTE_COUNTS), "Observed final membership changed", { characters: characters.size, routes });
  return { manifest, characters, strokeTotal };
}

function validateEvidence(manifest) {
  validatePortableAuditJson(INDEX_PATH);
  const index = readJson(INDEX_PATH);
  check(index.artifact === "shizi-vector-data-440-clean-clone-evidence-index" && index.status === "TECHNICAL_AND_HUMAN_REVIEW_PASS_440", "Unexpected final evidence index");
  check(index.counts.records === 440 && index.counts.human_accepted === 440 && index.counts.human_review_pending === 0 && index.counts.product_scope_excluded === 20, "Evidence-index counts changed", index.counts);
  check(index.policy.raw_third_party_svg_gif_or_font_included === false && index.policy.accepted_records_directly_hash_bound === true && index.policy.machine_local_absolute_paths_forbidden === true, "Evidence-index policy changed");
  check(index.files.length === index.counts.files, "Evidence-index file count mismatch");

  const indexed = new Set();
  for (const file of index.files) {
    check(typeof file.path === "string" && file.path.startsWith("audit/vector-data-460-evidence/"), "Evidence path escapes audit directory", file);
    check(!indexed.has(file.path), "Duplicate indexed evidence path", { path: file.path });
    indexed.add(file.path);
    const filePath = path.join(ROOT, file.path);
    check(fs.existsSync(filePath) && sha256(filePath) === file.sha256 && fs.statSync(filePath).size === file.byte_size, "Indexed evidence binding mismatch", { path: file.path });
    if (file.path.endsWith(".json")) validatePortableAuditJson(filePath);
  }
  for (const required of [relative(RECORDS_PATH), relative(ROUTES_PATH), relative(CLOSURE_PATH), relative(RECEIPT_PATH)]) check(indexed.has(required), "Required final evidence is not indexed", { path: required });

  const closure = readJson(CLOSURE_PATH);
  check(closure.decision === "CLOSE_REPAIR_SCOPE_WITH_29_ACCEPTED_AND_20_PRODUCT_EXCLUDED", "Scope closure decision changed");
  check(closure.human_accepted_characters.length === 29 && closure.product_scope_excluded_characters.length === 20, "Scope closure counts changed");
  const excluded = new Set(closure.product_scope_excluded_characters);
  check(excluded.size === 20 && [...excluded].every(character => !manifest.records.some(row => row.character === character) && !fs.existsSync(path.join(ROOT, `data/${character}.json`))), "A product-excluded character remains practice-ready");

  const receipt = readJson(RECEIPT_PATH);
  check(receipt.artifact === "shizi-vector-data-finalize-440-import-receipt", "Unexpected final import receipt");
  check(receipt.counts.original_supplement === 460 && receipt.counts.accepted_replacements === 29 && receipt.counts.product_scope_exclusions === 20 && receipt.counts.final_supplement === 440, "Final import receipt counts changed");
  check(receipt.accepted_replacements.length === 29 && receipt.product_scope_exclusions.length === 20, "Final receipt record count changed");
  const replacements = new Map(receipt.accepted_replacements.map(row => [row.character, row]));
  for (const row of receipt.accepted_replacements) {
    check(indexed.has(row.acceptance_path), "Replacement acceptance is not indexed", { character: row.character, path: row.acceptance_path });
    check(sha256(path.join(ROOT, row.final_data_path)) === row.final_data_sha256 && row.final_data_sha256 === row.candidate_sha256, "Replacement final hash differs from accepted candidate", { character: row.character });
  }

  const recordEvidence = readJson(RECORDS_PATH);
  const routeEvidence = readJson(ROUTES_PATH);
  check(recordEvidence.artifact === "shizi-vector-data-440-source-target-map" && recordEvidence.records.length === 440, "Unexpected final record evidence");
  check(recordEvidence.counts.human_accepted === 440 && recordEvidence.counts.human_review_pending === 0 && recordEvidence.counts.product_scope_excluded === 20, "Record evidence counts changed");
  check(routeEvidence.artifact === "shizi-vector-data-440-route-evidence", "Unexpected final route evidence");
  check(routeEvidence.review_state.human_accepted === 440 && routeEvidence.review_state.human_review_pending === 0 && routeEvidence.review_state.product_scope_excluded === 20, "Route-evidence review state changed");
  check(routeEvidence.acceptance_reconciliation?.reconciled === true && routeEvidence.acceptance_reconciliation.final_human_accepted === 440, "Route acceptance does not reconcile");
  check(routeEvidence.routes.strokeorder_merge_79.count === 59 && routeEvidence.routes.strokeorder_merge_79.original_payloads_human_accepted === 30 && routeEvidence.routes.strokeorder_merge_79.corrected_payloads_human_accepted === 29 && routeEvidence.routes.strokeorder_merge_79.product_scope_excluded_count === 20, "Strokeorder final disposition changed");

  const manifestByCharacter = new Map(manifest.records.map(row => [row.character, row]));
  const evidenceCharacters = new Set();
  for (const row of recordEvidence.records) {
    check(!evidenceCharacters.has(row.character), "Duplicate record evidence", { character: row.character });
    evidenceCharacters.add(row.character);
    const expected = manifestByCharacter.get(row.character);
    check(expected && expected.route === row.route, "Record evidence route mismatch", { character: row.character });
    check(row.target.path === expected.data_path && row.target.sha256 === expected.data_sha256 && row.target.byte_size === expected.byte_size, "Record evidence target mismatch", { character: row.character });
    check(row.target.normative_stroke_count === expected.normative_stroke_count && row.target.stroke_count === expected.stroke_count && row.target.median_count === expected.median_count, "Record evidence count mismatch", { character: row.character });
    check(row.human_review.status === "HUMAN_ACCEPTED" && row.human_review.acceptance_path === expected.acceptance_path && indexed.has(expected.acceptance_path), "Record evidence acceptance mismatch", { character: row.character });
    const sourceHash = row.source_fingerprint.accepted_candidate?.sha256 || row.source_fingerprint.sha256;
    check(sourceHash === expected.source_sha256, "Record evidence source hash mismatch", { character: row.character });
    if (replacements.has(row.character)) check(row.human_review.accepted_target_sha256 === expected.data_sha256, "Corrected record acceptance hash mismatch", { character: row.character });
  }
  check(evidenceCharacters.size === 440, "Record evidence membership changed");
  return { indexedFiles: index.files.length, replacements: replacements.size, excluded: excluded.size };
}

function findChromeExecutable() {
  return [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean).find(fs.existsSync);
}

async function validateBrowserPaths(manifest, browserSampleSize = null) {
  const { chromium } = require("playwright");
  const executablePath = findChromeExecutable();
  check(executablePath, "No Chrome or Chromium executable is available");
  const records = browserSampleSize === null ? manifest.records : manifest.records.slice(0, browserSampleSize);
  const rows = records.map(record => ({ character: record.character, expectedStrokeCount: record.stroke_count }));
  const expectedStrokeTotal = rows.reduce((sum, row) => sum + row.expectedStrokeCount, 0);
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end('<!doctype html><meta charset="utf-8"><svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg>');
        return;
      }
      const filePath = path.resolve(ROOT, `.${pathname}`);
      check(filePath.startsWith(`${ROOT}${path.sep}`), "Render server rejected an out-of-root path");
      const fileBytes = fs.readFileSync(filePath);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(fileBytes);
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(String(error.message || error));
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const chunkSize = 20;
    let checkedStrokes = 0;
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const result = await page.evaluate(async (batch) => {
        const svg = document.getElementById("canvas");
        const failures = [];
        let checked = 0;
        for (const row of batch) {
          try {
            const response = await fetch(`data/${encodeURIComponent(row.character)}.json`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (!Array.isArray(payload.strokes) || payload.strokes.length !== row.expectedStrokeCount) throw new Error(`unexpected stroke count ${payload.strokes?.length}`);
            payload.strokes.forEach((stroke, index) => {
              try {
                const element = document.createElementNS("http://www.w3.org/2000/svg", "path");
                element.setAttribute("d", stroke);
                svg.appendChild(element);
                const length = element.getTotalLength();
                const box = element.getBBox();
                const values = [length, box.x, box.y, box.width, box.height];
                if (!values.every(Number.isFinite) || length <= 0 || box.width + box.height <= 0) failures.push({ character: row.character, index, length, box: [box.x, box.y, box.width, box.height] });
                element.remove();
                checked += 1;
              } catch (error) {
                failures.push({ character: row.character, index, error: String(error) });
              }
            });
          } catch (error) {
            failures.push({ character: row.character, fetch_error: String(error) });
          }
        }
        return { failures, checked };
      }, chunk);
      check(result.failures.length === 0, "Browser SVG render gate failed", result.failures.slice(0, 10));
      checkedStrokes += result.checked;
    }
    check(checkedStrokes === expectedStrokeTotal, "Browser SVG render stroke total changed", { expectedStrokeTotal, checkedStrokes });
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  return { checkedCharacters: rows.length, checkedStrokes: expectedStrokeTotal };
}

async function main() {
  const { manifest, strokeTotal } = validateManifest();
  const evidence = validateEvidence(manifest);
  const staticOnly = process.argv.includes("--static-only");
  const sampleArgument = process.argv.find(value => value.startsWith("--browser-sample="));
  const browserSampleSize = sampleArgument ? Number(sampleArgument.split("=")[1]) : null;
  check(browserSampleSize === null || (Number.isInteger(browserSampleSize) && browserSampleSize > 0 && browserSampleSize <= 440), "Invalid --browser-sample value");
  const rendered = staticOnly ? null : await validateBrowserPaths(manifest, browserSampleSize);
  process.stdout.write(`${JSON.stringify({
    status: "TECHNICAL_AND_HUMAN_REVIEW_PASS_440",
    manifest: relative(MANIFEST_PATH),
    manifest_sha256: sha256(MANIFEST_PATH),
    evidence_index_sha256: sha256(INDEX_PATH),
    technically_verified_characters: 440,
    human_accepted_characters: 440,
    human_review_pending_characters: 0,
    product_scope_excluded_characters: 20,
    accepted_replacements: evidence.replacements,
    route_counts: manifest.counts.routes,
    evidence_files_verified: evidence.indexedFiles,
    static_and_evidence_gates: "PASS",
    browser_svg_render_gate: staticOnly ? "SKIPPED_BY_STATIC_ONLY" : `PASS_${rendered.checkedCharacters}_CHARACTERS_${rendered.checkedStrokes}_STROKES${browserSampleSize === null ? "" : "_SAMPLE"}`,
    expected_stroke_total: strokeTotal,
  }, null, 2)}\n`);
}

main().catch(error => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
