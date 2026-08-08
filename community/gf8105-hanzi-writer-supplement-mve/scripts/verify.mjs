import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

const EXPECTED_PACKAGE_FILES = [
  'characters.txt',
  'data',
  'docs',
  'LICENSE-ARPHIC.txt',
  'LICENSE-HANZI-WRITER.txt',
  'manifest.json',
  'provenance',
  'README.md',
  'review.html',
  'scripts',
  'THIRD_PARTY_NOTICES.md',
  'vendor',
];

const EXPECTED_SCOPE = {
  characters: ['抔', '拃', '馃'],
  character_count: 3,
  issue_character_count: 10,
  included_character_count: 3,
  remaining_characters_not_included: 7,
  claims_issue_resolution: false,
  generated_json_pr_payload: false,
  characters_sha256: '9833e470b05f101e23760b7b07799f29b90b7aa2daa7814abca87565df587226',
  stroke_count: 26,
  partial_response_to: 'https://github.com/chanind/hanzi-writer-data/issues/15',
};

const EXPECTED_SOURCE = {
  project: 'AnimCJK',
  repository: 'https://github.com/parsimonhi/animCJK',
  commit: 'ec5e17cca76c87587790bcbce5ea0b4d4fb753d6',
  file: 'graphicsZhHans.txt',
  locale: 'zh_hans',
  license: 'Arphic Public License',
  license_file: 'LICENSE-ARPHIC.txt',
};

const EXPECTED_TRANSFORMATION = {
  method: 'remove_character_key_and_serialize',
  strokes_semantically_unchanged: true,
  medians_semantically_unchanged: true,
  local_geometry_repairs: 0,
  rad_strokes_added: false,
};

const EXPECTED_RUNTIME = {
  name: 'hanzi-writer',
  version: '3.7.3',
  path: 'vendor/hanzi-writer-3.7.3.min.js',
  byte_size: 36968,
  sha256: '17b11a1e025b780cb518d49b30faacc770dfa7fbc387aa3876e3e5c1bd31e642',
  sri_sha384: 'sha384-xd6VpwMU5AxPFzG/nyhXrW70SSR2usiUNV8RrA0wlOjYlCrZyzZC6JiR/mT51pm2',
  source_url: 'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.3/dist/hanzi-writer.min.js',
  license_file: 'LICENSE-HANZI-WRITER.txt',
};

const EXPECTED_QUALITY = {
  normative_reference: 'Common Standard Chinese Characters Table (2013)',
  machine_structure: 'PASS',
  svg_path_parse: 'PASS',
  hanzi_writer_render_and_animation: 'PASS',
  same_character_human_review: 'PASS_IN_SOURCE_PROJECT',
  human_review_transcript_included: false,
  runtime_dependency: EXPECTED_RUNTIME,
};

const EXPECTED_PROVENANCE = {
  snapshot_path: 'provenance/graphicsZhHans.mve.jsonl',
  record_count: 3,
  byte_size: 8054,
  sha256: '9d88898da24b3a22b5f9ba32f92c570a0ac3e65cad872a8f1b486241a0773629',
  line_hash_includes_trailing_newline: true,
};

const EXPECTED_PUBLIC_BOUNDARY = {
  app_source_included: false,
  internal_review_transcripts_included: false,
  local_paths_included: false,
  chaifen_data_included: false,
};

const EXPECTED_RECORD_SOURCE = new Map([
  ['抔', { gf8105_level: 2, source_line: 2404, source_line_sha256: '34506f7b73b8d0d4e23244228f914f088ceec5fe37a433482587ed7431108c30' }],
  ['拃', { gf8105_level: 2, source_line: 2428, source_line_sha256: 'a9d7c1caaf5a5a10bc644fc9b9a1ac66dafaaa9835d06549834ca3a91d3beb8a' }],
  ['馃', { gf8105_level: 2, source_line: 7441, source_line_sha256: '2b0f73c44dfdcf7e5a38f7105c1071ba128183a489ec71f2354645c8e7e15369' }],
]);

const FORBIDDEN_FRAGMENTS = [
  ['/Us', 'ers/'].join(''),
  ['tmp', '/vector-mve'].join(''),
  ['external', '-local'].join(''),
  ['source', '_thread_id'].join(''),
  ['raw', '_message_id'].join(''),
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertExactKeys(value, expectedKeys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort(), `${label}: unexpected keys`);
}

function assertInsideRoot(root, filePath, label) {
  assert.ok(filePath === root || filePath.startsWith(`${root}${sep}`), `${label}: path escapes bundle root`);
}

function walkFiles(root, entryPath) {
  assertInsideRoot(root, entryPath, 'package entry');
  const stats = lstatSync(entryPath);
  assert.ok(!stats.isSymbolicLink(), `package entry must not be a symlink: ${relative(root, entryPath)}`);
  if (stats.isFile()) return [entryPath];
  assert.ok(stats.isDirectory(), `package entry has unsupported type: ${relative(root, entryPath)}`);
  return readdirSync(entryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => walkFiles(root, resolve(entryPath, entry.name)));
}

export function enumeratePublishFiles(root, packageJson) {
  assert.deepEqual(packageJson.files, EXPECTED_PACKAGE_FILES, 'package publish-file list drift');
  const files = [resolve(root, 'package.json')];
  for (const entry of packageJson.files) files.push(...walkFiles(root, resolve(root, entry)));
  return [...new Set(files)].sort();
}

export function validatePublishedTextEntries(entries) {
  for (const { path, content } of entries) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    for (const forbidden of FORBIDDEN_FRAGMENTS) {
      assert.equal(bytes.indexOf(Buffer.from(forbidden)), -1, `${path}: leaks internal value: ${forbidden}`);
    }
  }
}

export function validateDataFileSet(actualFileNames, records) {
  const expected = records.map((record) => `${record.character}.json`).sort();
  assert.deepEqual([...actualFileNames].sort(), expected, 'data directory membership mismatch');
}

export function validatePathData(pathData, label = 'stroke') {
  assert.equal(typeof pathData, 'string', `${label}: SVG path must be a string`);
  assert.ok(pathData.length > 0, `${label}: SVG path must not be empty`);

  const tokens = [];
  const tokenPattern = /([MLQCZ])|(-?(?:\d+(?:\.\d+)?|\.\d+))/g;
  let cursor = 0;
  for (const match of pathData.matchAll(tokenPattern)) {
    const gap = pathData.slice(cursor, match.index).replace(/[\s,]/g, '');
    assert.equal(gap, '', `${label}: unsupported SVG syntax near ${JSON.stringify(gap)}`);
    tokens.push(match[1] ?? Number(match[2]));
    cursor = match.index + match[0].length;
  }
  const tail = pathData.slice(cursor).replace(/[\s,]/g, '');
  assert.equal(tail, '', `${label}: unsupported trailing SVG syntax ${JSON.stringify(tail)}`);
  assert.ok(tokens.length > 0, `${label}: no SVG tokens found`);
  assert.equal(tokens[0], 'M', `${label}: path must begin with M`);

  const arity = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
  const coordinates = [];
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index];
    assert.equal(typeof command, 'string', `${label}: expected SVG command at token ${index}`);
    index += 1;
    const numbers = [];
    while (index < tokens.length && typeof tokens[index] === 'number') {
      assert.ok(Number.isFinite(tokens[index]), `${label}: non-finite coordinate`);
      numbers.push(tokens[index]);
      coordinates.push(tokens[index]);
      index += 1;
    }
    if (command === 'Z') {
      assert.equal(numbers.length, 0, `${label}: Z must not have coordinates`);
    } else {
      assert.ok(numbers.length >= arity[command], `${label}: ${command} has too few coordinates`);
      assert.equal(numbers.length % arity[command], 0, `${label}: ${command} coordinate arity mismatch`);
    }
  }

  assert.equal(coordinates.length % 2, 0, `${label}: coordinates must form x/y pairs`);
  const xs = coordinates.filter((_, coordinateIndex) => coordinateIndex % 2 === 0);
  const ys = coordinates.filter((_, coordinateIndex) => coordinateIndex % 2 === 1);
  assert.ok(Math.max(...xs) > Math.min(...xs), `${label}: zero-width bounding box`);
  assert.ok(Math.max(...ys) > Math.min(...ys), `${label}: zero-height bounding box`);
}

export function validateCharacterData(data, record) {
  assert.deepEqual(Object.keys(data).sort(), ['medians', 'strokes'], `${record.character}: unexpected top-level keys`);
  assert.ok(Array.isArray(data.strokes), `${record.character}: strokes must be an array`);
  assert.ok(Array.isArray(data.medians), `${record.character}: medians must be an array`);
  assert.equal(data.strokes.length, record.stroke_count, `${record.character}: stroke-count mismatch`);
  assert.equal(data.medians.length, record.median_count, `${record.character}: median-count mismatch`);
  assert.equal(data.strokes.length, data.medians.length, `${record.character}: strokes/medians mismatch`);

  data.strokes.forEach((stroke, strokeIndex) => {
    validatePathData(stroke, `${record.character} stroke ${strokeIndex + 1}`);
  });

  data.medians.forEach((median, medianIndex) => {
    assert.ok(Array.isArray(median), `${record.character} median ${medianIndex + 1}: must be an array`);
    assert.ok(median.length >= 2, `${record.character} median ${medianIndex + 1}: needs at least two points`);
    median.forEach((point, pointIndex) => {
      assert.ok(Array.isArray(point), `${record.character} median ${medianIndex + 1} point ${pointIndex + 1}: must be an array`);
      assert.equal(point.length, 2, `${record.character} median ${medianIndex + 1} point ${pointIndex + 1}: must be x/y`);
      assert.ok(point.every(Number.isFinite), `${record.character} median ${medianIndex + 1} point ${pointIndex + 1}: coordinates must be finite`);
    });
  });
}

export function validateProvenanceSnapshot(rawSnapshot, manifest, dataByCharacter) {
  assert.equal(rawSnapshot.byteLength, manifest.provenance.byte_size, 'provenance snapshot byte-size mismatch');
  assert.equal(sha256(rawSnapshot), manifest.provenance.sha256, 'provenance snapshot SHA-256 mismatch');
  const text = rawSnapshot.toString('utf8');
  assert.ok(text.endsWith('\n'), 'provenance snapshot must end with a newline');
  const lines = text.slice(0, -1).split('\n');
  assert.equal(lines.length, manifest.provenance.record_count, 'provenance snapshot record-count mismatch');
  assert.equal(lines.length, manifest.records.length, 'provenance/manifest record-count mismatch');

  lines.forEach((line, index) => {
    const record = manifest.records[index];
    assert.equal(sha256(`${line}\n`), record.source_line_sha256, `${record.character}: source-line SHA-256 mismatch`);
    const sourceRecord = JSON.parse(line);
    assert.deepEqual(Object.keys(sourceRecord).sort(), ['character', 'medians', 'strokes'], `${record.character}: unexpected source-record keys`);
    assert.equal(sourceRecord.character, record.character, `${record.character}: source character mismatch`);
    const sourceData = { strokes: sourceRecord.strokes, medians: sourceRecord.medians };
    assert.deepEqual(sourceData, dataByCharacter.get(record.character), `${record.character}: transformation changed source geometry`);
  });
}

function validateFrozenMetadata(manifest, packageJson) {
  assertExactKeys(manifest, ['schema_version', 'artifact', 'version', 'status', 'baseline', 'scope', 'source', 'transformation', 'quality', 'provenance', 'records', 'public_boundary'], 'manifest');
  assert.equal(manifest.schema_version, 1, 'schema version drift');
  assert.equal(manifest.artifact, 'gf8105-hanzi-writer-supplement-mve', 'artifact name drift');
  assert.equal(manifest.version, '0.0.0-mve.1', 'manifest version drift');
  assert.equal(manifest.status, 'TECHNICAL_MVE_PENDING_UPSTREAM_ROUTE_CONFIRMATION', 'status drift');
  assert.deepEqual(manifest.baseline, {
    project: 'hanzi-writer-data',
    version: '2.0.1',
    repository: 'https://github.com/chanind/hanzi-writer-data',
  }, 'baseline drift');
  assert.deepEqual(manifest.scope, EXPECTED_SCOPE, 'scope drift');
  assert.deepEqual(manifest.source, EXPECTED_SOURCE, 'source metadata drift');
  assert.deepEqual(manifest.transformation, EXPECTED_TRANSFORMATION, 'transformation metadata drift');
  assert.deepEqual(manifest.quality, EXPECTED_QUALITY, 'quality metadata drift');
  assert.deepEqual(manifest.provenance, EXPECTED_PROVENANCE, 'provenance metadata drift');
  assert.deepEqual(manifest.public_boundary, EXPECTED_PUBLIC_BOUNDARY, 'public boundary drift');

  assert.equal(packageJson.name, '@eim-aa/gf8105-hanzi-writer-supplement-mve', 'package name drift');
  assert.equal(packageJson.version, manifest.version, 'package/manifest version mismatch');
  assert.equal(packageJson.private, true, 'MVE package must remain private');
  assert.equal(packageJson.type, 'module', 'package module type drift');
  assert.deepEqual(packageJson.engines, { node: '>=20' }, 'package Node.js engine drift');
  assert.deepEqual(packageJson.files, EXPECTED_PACKAGE_FILES, 'package publish-file list drift');
  assert.deepEqual(packageJson.scripts, {
    verify: 'node scripts/verify.mjs',
    'verify:browser': 'node scripts/verify-browser.cjs',
    test: 'node --test scripts/verify.test.mjs',
  }, 'package scripts drift');
  assert.deepEqual(packageJson.devDependencies, { playwright: '1.62.0' }, 'browser test dependency drift');
}

export function validateBundle(root = DEFAULT_ROOT, manifestOverride = null) {
  const manifest = manifestOverride ?? JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  validateFrozenMetadata(manifest, packageJson);

  assert.ok(Array.isArray(manifest.records), 'manifest records must be an array');
  assert.equal(manifest.records.length, manifest.scope.character_count, 'manifest character-count mismatch');
  const recordCharacters = manifest.records.map((record) => record.character);
  assert.equal(new Set(recordCharacters).size, recordCharacters.length, 'duplicate character in manifest');
  assert.deepEqual(recordCharacters, manifest.scope.characters, 'manifest membership/order mismatch');
  assert.equal(sha256(recordCharacters.join('')), manifest.scope.characters_sha256, 'manifest membership hash mismatch');

  const charactersText = readFileSync(resolve(root, 'characters.txt'), 'utf8');
  assert.equal(charactersText, `${recordCharacters.join('\n')}\n`, 'characters.txt mismatch');

  const actualDataFiles = readdirSync(resolve(root, 'data'), { withFileTypes: true }).map((entry) => {
    assert.ok(entry.isFile(), `data directory contains non-file entry: ${entry.name}`);
    return entry.name;
  });
  validateDataFileSet(actualDataFiles, manifest.records);

  let totalStrokes = 0;
  const dataByCharacter = new Map();
  for (const record of manifest.records) {
    assertExactKeys(record, ['character', 'codepoint', 'gf8105_level', 'stroke_count', 'median_count', 'data_path', 'byte_size', 'sha256', 'source_line', 'source_line_sha256'], `${record.character} record`);
    assert.equal(record.codepoint, `U+${record.character.codePointAt(0).toString(16).toUpperCase()}`, `${record.character}: codepoint mismatch`);
    assert.equal(record.data_path, `data/${record.character}.json`, `${record.character}: data path mismatch`);
    assert.equal(record.stroke_count, record.median_count, `${record.character}: manifest strokes/medians mismatch`);
    assert.deepEqual(
      { gf8105_level: record.gf8105_level, source_line: record.source_line, source_line_sha256: record.source_line_sha256 },
      EXPECTED_RECORD_SOURCE.get(record.character),
      `${record.character}: frozen source metadata drift`,
    );

    const raw = readFileSync(resolve(root, record.data_path));
    assert.equal(raw.byteLength, record.byte_size, `${record.character}: byte-size mismatch`);
    assert.equal(sha256(raw), record.sha256, `${record.character}: SHA-256 mismatch`);
    const data = JSON.parse(raw.toString('utf8'));
    validateCharacterData(data, record);
    dataByCharacter.set(record.character, data);
    totalStrokes += data.strokes.length;
  }
  assert.equal(totalStrokes, manifest.scope.stroke_count, 'total stroke-count mismatch');

  const provenanceRaw = readFileSync(resolve(root, manifest.provenance.snapshot_path));
  validateProvenanceSnapshot(provenanceRaw, manifest, dataByCharacter);

  const runtimeRaw = readFileSync(resolve(root, manifest.quality.runtime_dependency.path));
  assert.equal(runtimeRaw.byteLength, manifest.quality.runtime_dependency.byte_size, 'Hanzi Writer runtime byte-size mismatch');
  assert.equal(sha256(runtimeRaw), manifest.quality.runtime_dependency.sha256, 'Hanzi Writer runtime SHA-256 mismatch');

  const publishFiles = enumeratePublishFiles(root, packageJson);
  const publishEntries = publishFiles
    .map((filePath) => ({ path: relative(root, filePath), content: readFileSync(filePath) }));
  validatePublishedTextEntries(publishEntries);

  return { characters: recordCharacters.length, strokes: totalStrokes, files: publishFiles.length };
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    const summary = validateBundle();
    console.log(`PASS ${summary.characters} characters, ${summary.strokes} strokes, ${summary.files} public files`);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
