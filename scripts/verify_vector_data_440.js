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
const PRODUCTION_APPROVAL_PATH = path.join(ROOT, "audit/vector-data-460-evidence/authorizations/finalize-440-production-import.json");
const RECEIPT_PATH = path.join(ROOT, "audit/vector-data-460-evidence/imports/finalize-440.json");
const EXPECTED_ROUTE_COUNTS = { animcjk_363: 363, moe_stroke_svg_10: 10, human_generated_8: 8, strokeorder_merge_79: 59 };
const EXPECTED_ACCEPTANCE_PATH_COUNTS = {
  "audit/vector-data-460-evidence/acceptances/animcjk-363.json": 363,
  "audit/vector-data-460-evidence/acceptances/human-batch20-3.json": 3,
  "audit/vector-data-460-evidence/acceptances/human-batch20-third-2.json": 2,
  "audit/vector-data-460-evidence/acceptances/human-type-unknown-4.json": 3,
  "audit/vector-data-460-evidence/acceptances/moe-10.json": 10,
  "audit/vector-data-460-evidence/review-decisions/strokeorder-79-partial.json": 30,
  "audit/vector-data-460-evidence/review-decisions/strokeorder-direct-grass-two.json": 2,
  "audit/vector-data-460-evidence/review-decisions/strokeorder-direct-grass-four.json": 4,
  "audit/vector-data-460-evidence/review-decisions/strokeorder-direct-grass-scale.json": 17,
  "audit/vector-data-460-evidence/review-decisions/strokeorder-side-component-two.json": 2,
  "audit/vector-data-460-evidence/review-decisions/strokeorder-side-component-four.json": 4,
};
const BASE_ACCEPTANCE_PATHS = new Set(Object.keys(EXPECTED_ACCEPTANCE_PATH_COUNTS).slice(0, 5));

function check(value, message, details) {
  if (!value) throw new Error(`${message}${details === undefined ? "" : `: ${JSON.stringify(details)}`}`);
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function checkSha256(value, message, details) {
  check(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), message, details);
}

function sameMembers(left, right) {
  return left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length
    && left.every(value => new Set(right).has(value));
}

function checkUniqueCharacterRows(rows, label) {
  const characters = rows.map(row => row.character);
  check(characters.every(character => typeof character === "string" && [...character].length === 1), `${label} has an invalid character`);
  check(new Set(characters).size === characters.length, `${label} has duplicate characters`);
}

function mustRejectMutation(label, action) {
  let rejected = false;
  try { action(); } catch (_) { rejected = true; }
  check(rejected, "Semantic mutation guard failed open", { label });
}

function validateProductionApprovalLocator(approval, closure) {
  const trace = approval.interaction_evidence;
  const proposal = trace?.preceding_proposal;
  const userApproval = trace?.approval;
  const event = approval.authorization_event;
  const revision = approval.authorization_revision;

  check(
    approval.record_type === "RETROSPECTIVE_TRANSCRIPTION_OF_PRIOR_CONVERSATION_AUTHORIZATION"
      && approval.recorded_at_utc === "2026-08-07T13:19:05Z"
      && revision?.revision === 2
      && revision.corrected_at_utc === "2026-08-07T14:15:43.120Z"
      && revision.prior_committed_sha256 === "717308edf4e45edd5fe34bbefb44ba04a88609283debbd738bc48dbc2707af7b",
    "Production authorization transcription revision metadata is missing",
  );
  check(
    trace?.source_thread_id === "019fa8ed-4419-76f1-b7a8-01bd6a67a1c5"
      && trace.delegation_source_thread_id === "019fa8c3-c58b-7b10-b202-0f351f4d97b1"
      && trace.source_thread_id !== trace.delegation_source_thread_id
      && trace.thread_title === "拾字矢量笔画数据源专项调查"
      && trace.evidence_source === "Codex original session response_item archive and read_thread projection",
    "Production approval points to the wrong interaction task",
  );
  check(
    proposal?.turn_id === "019fd7ae-c90a-7a32-866e-b63a465d9021"
      && proposal.raw_message_id === "msg_04ef0ef2b832824a016a74a7f1a58081919826244eaa8ea4d4"
      && proposal.thread_item_id === "item-2760"
      && proposal.timestamp_utc === "2026-08-06T15:27:51.624Z"
      && proposal.role === "assistant"
      && proposal.message_sha256 === "12838aeb7a7249bf570731045a6d1e5bf755cd7c1f2ba98964bf7a9457020fe4"
      && sha256Text(proposal.message_verbatim) === proposal.message_sha256,
    "Production import proposal locator or message binding changed",
  );
  check(
    userApproval?.turn_id === "019fd7b0-dae0-7d80-bf8e-4fef88576f8d"
      && userApproval.raw_message_id === "msg_019fd7b0-db53-74a1-bebe-aab67953597b"
      && userApproval.thread_item_id === "item-2761"
      && userApproval.timestamp_utc === "2026-08-06T15:28:39.763Z"
      && userApproval.role === "user"
      && userApproval.message_sha256 === "b6f4b57ade409674cb0a60c9d9a67eb714f0c6bc2bfc9878f15547e39b444533"
      && sha256Text(userApproval.message_verbatim) === userApproval.message_sha256
      && userApproval.message_verbatim === "批准\n"
      && trace.reviewer_response_verbatim === userApproval.message_verbatim
      && trace.reviewer_response_normalized === "批准",
    "Production approval response locator or message binding changed",
  );
  check(
    event?.occurred_at_utc === userApproval.timestamp_utc
      && event.occurred_at_local === "2026-08-06T23:28:39.763+08:00"
      && event.timezone === "Asia/Shanghai"
      && event.timestamp_precision === "millisecond_from_original_session_response_item"
      && trace.sequence === "IMMEDIATE_NEXT_USER_TURN_AFTER_PROPOSAL",
    "Production approval event metadata changed",
  );

  const closureTime = Date.parse(closure.recorded_at_utc);
  const proposalTime = Date.parse(proposal.timestamp_utc);
  const approvalTime = Date.parse(userApproval.timestamp_utc);
  const transcriptionTime = Date.parse(approval.recorded_at_utc);
  const correctionTime = Date.parse(revision.corrected_at_utc);
  check(
    [closureTime, proposalTime, approvalTime, transcriptionTime, correctionTime].every(Number.isFinite)
      && closureTime < proposalTime
      && proposalTime < approvalTime
      && approvalTime < transcriptionTime
      && transcriptionTime < correctionTime
      && approvalTime - proposalTime === 48139
      && trace.elapsed_milliseconds === 48139,
    "Production approval chronology changed",
  );
}

function validateProductionApprovalLocatorMutationGuards(approval, closure) {
  const clone = () => JSON.parse(JSON.stringify(approval));
  let guards = 0;
  mustRejectMutation("approval_source_thread_is_delegation_source", () => {
    const mutated = clone();
    mutated.interaction_evidence.source_thread_id = mutated.interaction_evidence.delegation_source_thread_id;
    validateProductionApprovalLocator(mutated, closure);
  });
  guards += 1;
  for (const [section, field] of [
    ["preceding_proposal", "turn_id"],
    ["preceding_proposal", "raw_message_id"],
    ["preceding_proposal", "thread_item_id"],
    ["approval", "turn_id"],
    ["approval", "raw_message_id"],
    ["approval", "thread_item_id"],
  ]) {
    mustRejectMutation(`approval_locator_missing_${section}_${field}`, () => {
      const mutated = clone();
      delete mutated.interaction_evidence[section][field];
      validateProductionApprovalLocator(mutated, closure);
    });
    guards += 1;
  }
  mustRejectMutation("approval_proposal_message_tamper", () => {
    const mutated = clone();
    mutated.interaction_evidence.preceding_proposal.message_verbatim += " ";
    validateProductionApprovalLocator(mutated, closure);
  });
  guards += 1;
  mustRejectMutation("approval_response_message_tamper", () => {
    const mutated = clone();
    mutated.interaction_evidence.approval.message_verbatim = "通过\n";
    validateProductionApprovalLocator(mutated, closure);
  });
  guards += 1;
  mustRejectMutation("approval_timestamp_or_order_tamper", () => {
    const mutated = clone();
    mutated.interaction_evidence.preceding_proposal.timestamp_utc = mutated.interaction_evidence.approval.timestamp_utc;
    validateProductionApprovalLocator(mutated, closure);
  });
  guards += 1;
  return guards;
}

function semanticRecord(character, decision, sourceSha256, dataSha256 = null) {
  check(typeof character === "string" && [...character].length === 1, "Acceptance character is invalid", { character });
  checkSha256(sourceSha256, "Acceptance candidate hash is invalid", { character, sourceSha256 });
  if (dataSha256 !== null) checkSha256(dataSha256, "Acceptance final-data hash is invalid", { character, dataSha256 });
  return { character, decision, sourceSha256, dataSha256 };
}

function addSemanticRecord(records, value, acceptancePath) {
  check(!records.has(value.character), "Duplicate character in acceptance evidence", { acceptancePath, character: value.character });
  records.set(value.character, value);
}

function parseAcceptanceSemantics(acceptancePath) {
  check(EXPECTED_ACCEPTANCE_PATH_COUNTS[acceptancePath] !== undefined, "Unknown manifest acceptance file", { acceptancePath });
  const payload = readJson(path.join(ROOT, acceptancePath));
  const records = new Map();

  if (BASE_ACCEPTANCE_PATHS.has(acceptancePath)) {
    check(payload.decision === "HUMAN_ACCEPTED" && Array.isArray(payload.characters), "Unexpected base acceptance schema", { acceptancePath });
    for (const row of payload.characters) {
      check(row.decision === "HUMAN_ACCEPTED", "Base acceptance contains a non-accepted row", { acceptancePath, character: row.character, decision: row.decision });
      const sourceSha256 = row.candidate_sha256 || row.draft_sha256;
      check(!(row.candidate_sha256 && row.draft_sha256), "Base acceptance has ambiguous candidate hashes", { acceptancePath, character: row.character });
      addSemanticRecord(records, semanticRecord(row.character, row.decision, sourceSha256), acceptancePath);
    }
    return records;
  }

  if (acceptancePath.endsWith("/strokeorder-79-partial.json")) {
    check(payload.decision === "PARTIAL_ACCEPTANCE" && Array.isArray(payload.records), "Unexpected partial-acceptance schema");
    const seen = new Set();
    for (const row of payload.records) {
      check(!seen.has(row.character), "Duplicate partial-review character", { character: row.character });
      seen.add(row.character);
      if (row.decision !== "HUMAN_ACCEPTED") continue;
      addSemanticRecord(records, semanticRecord(row.character, row.decision, row.source_candidate_sha256, row.final_data_sha256), acceptancePath);
    }
    check(records.size === 30 && payload.records.filter(row => row.decision !== "HUMAN_ACCEPTED").length === 49, "Partial-review disposition changed");
    return records;
  }

  if (acceptancePath.endsWith("/strokeorder-direct-grass-two.json")) {
    check(payload.decision === "HUMAN_ACCEPTED" && Array.isArray(payload.scope?.characters), "Unexpected two-character grass acceptance schema");
    check(sameMembers(payload.scope.characters, Object.keys(payload.reviewed_payloads || {})), "Two-character grass scope/bindings differ");
    for (const character of payload.scope.characters) {
      const row = payload.reviewed_payloads[character];
      check(row?.decision === "HUMAN_ACCEPTED", "Two-character grass decision changed", { character, decision: row?.decision });
      addSemanticRecord(records, semanticRecord(character, row.decision, row.candidate?.sha256), acceptancePath);
    }
    return records;
  }

  if (acceptancePath.endsWith("/strokeorder-direct-grass-four.json")) {
    check(payload.decision === "HUMAN_ACCEPTED_AND_SCALE_AUTHORIZED" && Array.isArray(payload.scope?.characters), "Unexpected four-character grass acceptance schema");
    check(sameMembers(payload.scope.characters, Object.keys(payload.candidate_bindings || {})), "Four-character grass scope/bindings differ");
    for (const character of payload.scope.characters) {
      addSemanticRecord(records, semanticRecord(character, "HUMAN_ACCEPTED", payload.candidate_bindings[character]?.candidate?.sha256), acceptancePath);
    }
    return records;
  }

  if (acceptancePath.endsWith("/strokeorder-direct-grass-scale.json")) {
    check(payload.decision === "HUMAN_REVIEW_COMPLETE_WITH_17_ACCEPTED_3_REJECTED", "Unexpected grass-scale decision");
    const accepted = payload.scope?.human_accepted;
    const rejected = payload.scope?.human_rejected;
    check(Array.isArray(accepted) && Array.isArray(rejected) && accepted.length === 17 && rejected.length === 3, "Grass-scale disposition counts changed");
    check(sameMembers([...accepted, ...rejected], payload.scope.characters), "Grass-scale scope/disposition differs");
    for (const character of accepted) {
      const row = payload.reviewed_payloads?.[character];
      check(row?.decision === "HUMAN_ACCEPTED", "Accepted grass-scale row decision changed", { character, decision: row?.decision });
      addSemanticRecord(records, semanticRecord(character, row.decision, row.candidate?.sha256), acceptancePath);
    }
    for (const character of rejected) {
      check(payload.reviewed_payloads?.[character]?.decision === "HUMAN_REJECTED", "Rejected grass-scale row decision changed", { character });
    }
    return records;
  }

  if (acceptancePath.endsWith("/strokeorder-side-component-two.json") || acceptancePath.endsWith("/strokeorder-side-component-four.json")) {
    const expectedDecision = acceptancePath.endsWith("-two.json") ? "HUMAN_ACCEPTED_BOTH" : "HUMAN_ACCEPTED_ALL_FOUR";
    check(payload.decision === expectedDecision && payload.production_import_allowed === false, "Unexpected side-component acceptance schema", { acceptancePath });
    check(sameMembers(payload.accepted_characters, Object.keys(payload.frozen_evidence?.candidates || {})), "Side-component scope/bindings differ", { acceptancePath });
    for (const character of payload.accepted_characters) {
      addSemanticRecord(records, semanticRecord(character, "HUMAN_ACCEPTED", payload.frozen_evidence.candidates[character]?.sha256), acceptancePath);
    }
    return records;
  }

  throw new Error(`No semantic acceptance parser for ${acceptancePath}`);
}

function validateAcceptanceBinding(record, accepted, acceptancePath) {
  check(accepted, "Manifest character is absent from its acceptance record", { character: record.character, acceptancePath });
  check(accepted.decision === "HUMAN_ACCEPTED", "Manifest character is not semantically accepted", { character: record.character, acceptancePath, decision: accepted.decision });
  check(accepted.sourceSha256 === record.source_sha256, "Manifest source hash differs from accepted candidate", { character: record.character, acceptancePath, manifest: record.source_sha256, accepted: accepted.sourceSha256 });
  if (accepted.dataSha256 !== null) {
    check(accepted.dataSha256 === record.data_sha256, "Manifest data hash differs from acceptance record", { character: record.character, acceptancePath, manifest: record.data_sha256, accepted: accepted.dataSha256 });
  }
}

function validateSemanticMutationGuards(sampleRecord, sampleAcceptance) {
  mustRejectMutation("character", () => validateAcceptanceBinding(sampleRecord, undefined, sampleRecord.acceptance_path));
  mustRejectMutation("decision", () => validateAcceptanceBinding(sampleRecord, { ...sampleAcceptance, decision: "HUMAN_REJECTED" }, sampleRecord.acceptance_path));
  mustRejectMutation("candidate_hash", () => validateAcceptanceBinding(sampleRecord, { ...sampleAcceptance, sourceSha256: "0".repeat(64) }, sampleRecord.acceptance_path));
  return 3;
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
  check(
    manifest.gates.acceptance_semantics_gate === "440 character + decision + candidate hash bindings verified"
      && manifest.gates.separate_product_approval_gate === "29 replacements + 20 exclusions approved",
    "Final semantic or production-approval gate changed",
  );
  check(manifest.clean_clone_evidence.index_path === "audit/vector-data-460-evidence-index.json" && sha256(INDEX_PATH) === manifest.clean_clone_evidence.index_sha256, "Evidence-index binding mismatch");

  const characters = new Set();
  const routes = Object.fromEntries(Object.keys(EXPECTED_ROUTE_COUNTS).map(route => [route, 0]));
  const acceptancePathCounts = Object.fromEntries(Object.keys(EXPECTED_ACCEPTANCE_PATH_COUNTS).map(acceptancePath => [acceptancePath, 0]));
  const acceptanceCatalog = new Map();
  let strokeTotal = 0;
  let semanticAcceptanceRecords = 0;
  for (const record of manifest.records) {
    check(!characters.has(record.character), "Duplicate manifest character", { character: record.character });
    characters.add(record.character);
    check(routes[record.route] !== undefined, "Unknown final route", { character: record.character, route: record.route });
    routes[record.route] += 1;
    check(record.human_review_status === "HUMAN_ACCEPTED" && typeof record.acceptance_path === "string", "Final record is not human accepted", { character: record.character });
    check(acceptancePathCounts[record.acceptance_path] !== undefined, "Manifest references an unexpected acceptance file", { character: record.character, acceptancePath: record.acceptance_path });
    if (!acceptanceCatalog.has(record.acceptance_path)) acceptanceCatalog.set(record.acceptance_path, parseAcceptanceSemantics(record.acceptance_path));
    validateAcceptanceBinding(record, acceptanceCatalog.get(record.acceptance_path).get(record.character), record.acceptance_path);
    acceptancePathCounts[record.acceptance_path] += 1;
    semanticAcceptanceRecords += 1;
    check(record.data_path === `data/${record.character}.json`, "Data path/character mismatch", { character: record.character });
    const dataPath = path.join(ROOT, record.data_path);
    check(fs.existsSync(dataPath) && sha256(dataPath) === record.data_sha256 && fs.statSync(dataPath).size === record.byte_size, "Final data binding mismatch", { character: record.character });
    const payload = readJson(dataPath);
    validatePayload(record.character, payload, record.normative_stroke_count);
    check(payload.strokes.length === record.stroke_count && payload.medians.length === record.median_count, "Manifest payload counts differ", { character: record.character });
    strokeTotal += record.stroke_count;
  }
  check(characters.size === 440 && JSON.stringify(routes) === JSON.stringify(EXPECTED_ROUTE_COUNTS), "Observed final membership changed", { characters: characters.size, routes });
  check(JSON.stringify(acceptancePathCounts) === JSON.stringify(EXPECTED_ACCEPTANCE_PATH_COUNTS), "Manifest acceptance-file coverage changed", acceptancePathCounts);
  check(acceptanceCatalog.size === 11 && semanticAcceptanceRecords === 440, "Semantic acceptance coverage is incomplete", { files: acceptanceCatalog.size, records: semanticAcceptanceRecords });
  const sampleRecord = manifest.records[0];
  const semanticMutationGuards = validateSemanticMutationGuards(sampleRecord, acceptanceCatalog.get(sampleRecord.acceptance_path).get(sampleRecord.character));
  return { manifest, characters, strokeTotal, semanticAcceptanceRecords, acceptanceFiles: acceptanceCatalog.size, semanticMutationGuards };
}

function validateReplacementBinding(row, approved, manifestRecord, indexed) {
  check(approved && manifestRecord, "Replacement is absent from approval or manifest", { character: row.character });
  check(indexed.has(row.acceptance_path), "Replacement acceptance is not indexed", { character: row.character, path: row.acceptance_path });
  check(row.final_data_path === `data/${row.character}.json`, "Replacement character/final path mismatch", { character: row.character, final_data_path: row.final_data_path });
  check(row.candidate_path === manifestRecord.source_path, "Historical candidate path differs from manifest provenance", { character: row.character });
  check(
    row.acceptance_path === manifestRecord.acceptance_path
      && row.candidate_sha256 === manifestRecord.source_sha256
      && row.final_data_path === manifestRecord.data_path
      && row.final_data_sha256 === manifestRecord.data_sha256,
    "Replacement receipt differs from manifest",
    { character: row.character },
  );
  check(sha256(path.join(ROOT, row.final_data_path)) === row.final_data_sha256 && row.final_data_sha256 === row.candidate_sha256, "Replacement final hash differs from accepted candidate", { character: row.character });
  check(
    approved.candidate_sha256 === row.candidate_sha256
      && approved.acceptance_path === row.acceptance_path
      && approved.final_data_path === row.final_data_path,
    "Final replacement differs from the separately approved payload",
    { character: row.character },
  );
}

function validateReceiptMutationGuards(receipt, approvedReplacements, manifestByCharacter, indexed) {
  const [first, second] = receipt.accepted_replacements;
  mustRejectMutation("swapped_candidate_hash", () => validateReplacementBinding(
    { ...first, candidate_sha256: second.candidate_sha256 },
    approvedReplacements.get(first.character),
    manifestByCharacter.get(first.character),
    indexed,
  ));
  mustRejectMutation("swapped_character_path", () => validateReplacementBinding(
    { ...first, character: second.character },
    approvedReplacements.get(second.character),
    manifestByCharacter.get(second.character),
    indexed,
  ));
  mustRejectMutation("duplicate_receipt_character", () => checkUniqueCharacterRows(
    [first, { ...second, character: first.character }],
    "Mutated receipt",
  ));
  return 3;
}

function validateEvidence(manifest) {
  validatePortableAuditJson(INDEX_PATH);
  const index = readJson(INDEX_PATH);
  check(index.artifact === "shizi-vector-data-440-clean-clone-evidence-index" && index.status === "TECHNICAL_AND_HUMAN_REVIEW_PASS_440", "Unexpected final evidence index");
  check(index.counts.records === 440 && index.counts.human_accepted === 440 && index.counts.human_review_pending === 0 && index.counts.product_scope_excluded === 20, "Evidence-index counts changed", index.counts);
  check(
    index.policy.raw_third_party_svg_gif_or_font_included === false
      && index.policy.accepted_records_directly_hash_bound === true
      && index.policy.accepted_records_semantically_bound === true
      && index.policy.production_import_requires_separate_product_approval === true
      && index.policy.machine_local_absolute_paths_forbidden === true,
    "Evidence-index policy changed",
  );
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
  for (const required of [relative(RECORDS_PATH), relative(ROUTES_PATH), relative(CLOSURE_PATH), relative(PRODUCTION_APPROVAL_PATH), relative(RECEIPT_PATH)]) check(indexed.has(required), "Required final evidence is not indexed", { path: required });

  const closure = readJson(CLOSURE_PATH);
  check(closure.decision === "CLOSE_REPAIR_SCOPE_WITH_29_ACCEPTED_AND_20_PRODUCT_EXCLUDED", "Scope closure decision changed");
  check(closure.human_accepted_characters.length === 29 && closure.product_scope_excluded_characters.length === 20, "Scope closure counts changed");
  checkUniqueCharacterRows(closure.human_accepted_characters.map(character => ({ character })), "Scope-closure accepted characters");
  checkUniqueCharacterRows(closure.product_scope_excluded_characters.map(character => ({ character })), "Scope-closure excluded characters");
  check(closure.human_accepted_characters.every(character => !closure.product_scope_excluded_characters.includes(character)), "Scope-closure accepted/excluded sets overlap");
  check(closure.production_import_allowed === false && typeof closure.next_action_requires_separate_approval === "string", "Historical closure no longer requires separate production approval");
  for (const binding of Object.values(closure.frozen_review_evidence || {})) {
    check(indexed.has(binding.path), "Closure-bound review evidence is not indexed", binding);
    check(sha256(path.join(ROOT, binding.path)) === binding.sha256, "Closure-bound review evidence hash mismatch", binding);
  }
  check(Object.keys(closure.frozen_review_evidence || {}).length === 6, "Closure review-evidence binding count changed");
  const partialReview = readJson(path.join(ROOT, "audit/vector-data-460-evidence/review-decisions/strokeorder-79-partial.json"));
  const originalIssueRows = partialReview.records.filter(row => row.decision === "ISSUE_REPORTED");
  check(originalIssueRows.length === 49 && sameMembers(
    originalIssueRows.map(row => row.character),
    [...closure.human_accepted_characters, ...closure.product_scope_excluded_characters],
  ), "Scope closure does not exactly reconcile the original 49 issue-reported characters");
  const excluded = new Set(closure.product_scope_excluded_characters);
  check(excluded.size === 20 && [...excluded].every(character => !manifest.records.some(row => row.character === character) && !fs.existsSync(path.join(ROOT, `data/${character}.json`))), "A product-excluded character remains practice-ready");

  const approval = readJson(PRODUCTION_APPROVAL_PATH);
  check(approval.artifact === "shizi-vector-data-finalize-440-production-import-authorization" && approval.decision === "PRODUCTION_IMPORT_APPROVED_FOR_EXACT_FROZEN_PAYLOADS", "Unexpected separate production approval");
  validateProductionApprovalLocator(approval, closure);
  const approvalLocatorMutationGuards = validateProductionApprovalLocatorMutationGuards(approval, closure);
  check(
    approval.production_import_allowed === true
      && approval.reviewer_role === "product_owner"
      && approval.interaction_evidence?.reviewer_response_normalized === "批准",
    "Separate production approval is not affirmative",
  );
  check(approval.closure_binding?.path === relative(CLOSURE_PATH) && approval.closure_binding.sha256 === sha256(CLOSURE_PATH), "Production approval does not bind the historical closure");
  check(approval.closure_binding.production_import_allowed_at_closure === false && approval.closure_binding.separate_approval_requirement === closure.next_action_requires_separate_approval, "Production approval does not preserve the closure's original prohibition");
  check(approval.scope?.accepted_replacements === 29 && approval.scope?.product_scope_exclusions === 20 && approval.scope?.final_supplement === 440, "Production approval scope changed");
  check(Array.isArray(approval.approved_replacements) && Array.isArray(approval.approved_product_scope_exclusions), "Production approval membership is missing");
  const approvedReplacements = new Map(approval.approved_replacements.map(row => [row.character, row]));
  const approvedExclusions = new Map(approval.approved_product_scope_exclusions.map(row => [row.character, row]));
  check(approvedReplacements.size === 29 && approvedReplacements.size === approval.approved_replacements.length, "Production approval has duplicate or missing replacements");
  check(approvedExclusions.size === 20 && approvedExclusions.size === approval.approved_product_scope_exclusions.length, "Production approval has duplicate or missing exclusions");
  check(sameMembers([...approvedReplacements.keys()], closure.human_accepted_characters), "Approved replacement membership differs from closure");
  check(sameMembers([...approvedExclusions.keys()], closure.product_scope_excluded_characters), "Approved exclusion membership differs from closure");

  const receipt = readJson(RECEIPT_PATH);
  check(receipt.artifact === "shizi-vector-data-finalize-440-import-receipt", "Unexpected final import receipt");
  check(
    receipt.receipt_revision?.revision === 3
      && receipt.receipt_revision.revised_at_utc === approval.authorization_revision.corrected_at_utc
      && receipt.receipt_revision.prior_committed_sha256 === "98bcf3fa307076d54cf463461930610c956c0c1b5b3a49a5b8625cc918c662f1"
      && receipt.receipt_revision.prior_revision?.revision === 2
      && receipt.receipt_revision.prior_revision.revised_at_utc === approval.recorded_at_utc
      && receipt.receipt_revision.prior_revision.prior_committed_sha256 === "ff4f14d22c80b54b270a0a681c08a182f5d2d516ac420133c674311218511d40",
    "Import receipt revision history is missing",
  );
  check(receipt.path_semantics?.candidate_path?.startsWith("HISTORICAL_PROVENANCE_ONLY"), "Historical tmp/ candidate-path semantics are not explicit");
  check(receipt.counts.original_supplement === 460 && receipt.counts.accepted_replacements === 29 && receipt.counts.product_scope_exclusions === 20 && receipt.counts.final_supplement === 440, "Final import receipt counts changed");
  check(receipt.accepted_replacements.length === 29 && receipt.product_scope_exclusions.length === 20, "Final receipt record count changed");
  check(receipt.decision_binding?.path === relative(CLOSURE_PATH) && receipt.decision_binding.sha256 === sha256(CLOSURE_PATH), "Import receipt does not bind the scope closure");
  check(receipt.production_approval_binding?.path === relative(PRODUCTION_APPROVAL_PATH) && receipt.production_approval_binding.sha256 === sha256(PRODUCTION_APPROVAL_PATH), "Import receipt does not bind the separate product approval");
  check(receipt.gates?.separate_product_approval_bound === true && receipt.gates?.production_import_allowed === true, "Import receipt permits production without the separate approval gate");
  check(manifest.production_import_approval?.path === relative(PRODUCTION_APPROVAL_PATH) && manifest.production_import_approval.sha256 === sha256(PRODUCTION_APPROVAL_PATH), "Final manifest does not bind the separate product approval");
  check(manifest.production_import_approval.accepted_replacements === 29 && manifest.production_import_approval.product_scope_exclusions === 20, "Manifest production-approval scope changed");
  check(
    manifest.revised_at_utc === approval.authorization_revision.corrected_at_utc
      && manifest.prior_committed_sha256 === "e543f5132e5b6d6b6d0837fd02a4d0f0803bec2baf926047451bb31200a5469a"
      && typeof manifest.revision_reason === "string",
    "Manifest revision metadata is missing",
  );
  checkUniqueCharacterRows(receipt.accepted_replacements, "Final receipt replacements");
  checkUniqueCharacterRows(receipt.product_scope_exclusions, "Final receipt exclusions");
  const replacements = new Map(receipt.accepted_replacements.map(row => [row.character, row]));
  const manifestByCharacter = new Map(manifest.records.map(row => [row.character, row]));
  for (const row of receipt.accepted_replacements) {
    const approved = approvedReplacements.get(row.character);
    validateReplacementBinding(row, approved, manifestByCharacter.get(row.character), indexed);
  }
  for (const row of receipt.product_scope_exclusions) {
    const approved = approvedExclusions.get(row.character);
    check(approved?.removed_data_path === row.removed_data_path && approved.removed_data_sha256 === row.removed_data_sha256, "Final exclusion differs from the separately approved scope", { character: row.character });
    check(row.removed_data_path === `data/${row.character}.json`, "Excluded character/path mismatch", { character: row.character, removed_data_path: row.removed_data_path });
  }
  const receiptMutationGuards = validateReceiptMutationGuards(receipt, approvedReplacements, manifestByCharacter, indexed);

  const recordEvidence = readJson(RECORDS_PATH);
  const routeEvidence = readJson(ROUTES_PATH);
  check(recordEvidence.artifact === "shizi-vector-data-440-source-target-map" && recordEvidence.records.length === 440, "Unexpected final record evidence");
  check(recordEvidence.counts.human_accepted === 440 && recordEvidence.counts.human_review_pending === 0 && recordEvidence.counts.product_scope_excluded === 20, "Record evidence counts changed");
  check(routeEvidence.artifact === "shizi-vector-data-440-route-evidence", "Unexpected final route evidence");
  check(routeEvidence.review_state.human_accepted === 440 && routeEvidence.review_state.human_review_pending === 0 && routeEvidence.review_state.product_scope_excluded === 20, "Route-evidence review state changed");
  check(routeEvidence.acceptance_reconciliation?.reconciled === true && routeEvidence.acceptance_reconciliation.final_human_accepted === 440, "Route acceptance does not reconcile");
  check(routeEvidence.routes.strokeorder_merge_79.count === 59 && routeEvidence.routes.strokeorder_merge_79.original_payloads_human_accepted === 30 && routeEvidence.routes.strokeorder_merge_79.corrected_payloads_human_accepted === 29 && routeEvidence.routes.strokeorder_merge_79.product_scope_excluded_count === 20, "Strokeorder final disposition changed");

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
  return {
    indexedFiles: index.files.length,
    replacements: replacements.size,
    excluded: excluded.size,
    productionApproval: "PASS",
    approvalLocatorMutationGuards,
    receiptMutationGuards,
  };
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
  const { manifest, strokeTotal, semanticAcceptanceRecords, acceptanceFiles, semanticMutationGuards } = validateManifest();
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
    production_import_approval_gate: evidence.productionApproval,
    approval_locator_mutation_guards_verified: evidence.approvalLocatorMutationGuards,
    semantic_acceptance_records_verified: semanticAcceptanceRecords,
    semantic_acceptance_files_verified: acceptanceFiles,
    semantic_mutation_guards_verified: semanticMutationGuards,
    receipt_mutation_guards_verified: evidence.receiptMutationGuards,
    route_counts: manifest.counts.routes,
    evidence_files_verified: evidence.indexedFiles,
    static_and_evidence_gates: "PASS",
    browser_svg_render_gate: staticOnly ? "SKIPPED_BY_STATIC_ONLY" : `PASS_${rendered.checkedCharacters}_CHARACTERS_${rendered.checkedStrokes}_STROKES${browserSampleSize === null ? "" : "_SAMPLE"}`,
    expected_stroke_total: strokeTotal,
  }, null, 2)}\n`);
}

main().catch(error => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
