import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  validateBundle,
  validateCharacterData,
  validateDataFileSet,
  validatePathData,
  validateProvenanceSnapshot,
  validatePublishedTextEntries,
} from './verify.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'));

function cloneManifest() {
  return structuredClone(MANIFEST);
}

test('frozen three-character bundle passes', () => {
  const summary = validateBundle(ROOT);
  assert.equal(summary.characters, 3);
  assert.equal(summary.strokes, 26);
  assert.ok(summary.files > 0);
});

test('duplicate character fails closed', () => {
  const manifest = cloneManifest();
  manifest.records[1].character = manifest.records[0].character;
  assert.throws(() => validateBundle(ROOT, manifest), /duplicate character|membership\/order mismatch/);
});

test('membership hash drift fails closed', () => {
  const manifest = cloneManifest();
  manifest.scope.characters_sha256 = '0'.repeat(64);
  assert.throws(() => validateBundle(ROOT, manifest), /scope drift|membership hash mismatch/);
});

test('file hash drift fails closed', () => {
  const manifest = cloneManifest();
  manifest.records[0].sha256 = 'f'.repeat(64);
  assert.throws(() => validateBundle(ROOT, manifest), /SHA-256 mismatch/);
});

test('stroke-count mismatch fails closed', () => {
  const record = { character: '测', stroke_count: 2, median_count: 1 };
  const data = { strokes: ['M0 0L1 1'], medians: [[[0, 0], [1, 1]]] };
  assert.throws(() => validateCharacterData(data, record), /stroke-count mismatch/);
});

test('unexpected data field fails closed', () => {
  const record = { character: '测', stroke_count: 1, median_count: 1 };
  const data = { strokes: ['M0 0L1 1'], medians: [[[0, 0], [1, 1]]], character: '测' };
  assert.throws(() => validateCharacterData(data, record), /unexpected top-level keys/);
});

test('unsupported SVG syntax fails closed', () => {
  assert.throws(() => validatePathData('M0 0A1 1 0 0 0 2 2'), /unsupported SVG syntax/);
});

test('internal path leakage in any public file fails closed', () => {
  const privatePath = ['/Us', 'ers/example/private.json'].join('');
  assert.throws(
    () => validatePublishedTextEntries([{ path: 'docs/leak.csv', content: Buffer.from(privatePath) }]),
    /leaks internal value/,
  );
});

test('claiming full issue resolution fails closed', () => {
  const manifest = cloneManifest();
  manifest.scope.claims_issue_resolution = true;
  assert.throws(() => validateBundle(ROOT, manifest), /scope drift/);
});

test('presenting the MVE as a generated JSON PR fails closed', () => {
  const manifest = cloneManifest();
  manifest.scope.generated_json_pr_payload = true;
  assert.throws(() => validateBundle(ROOT, manifest), /scope drift/);
});

test('source commit drift fails closed', () => {
  const manifest = cloneManifest();
  manifest.source.commit = '0'.repeat(40);
  assert.throws(() => validateBundle(ROOT, manifest), /source metadata drift/);
});

test('GF8105 level drift fails closed', () => {
  const manifest = cloneManifest();
  manifest.records[0].gf8105_level = 1;
  assert.throws(() => validateBundle(ROOT, manifest), /frozen source metadata drift/);
});

test('source-line hash drift fails closed', () => {
  const manifest = cloneManifest();
  manifest.records[0].source_line_sha256 = '0'.repeat(64);
  assert.throws(() => validateBundle(ROOT, manifest), /frozen source metadata drift/);
});

test('runtime dependency hash drift fails closed', () => {
  const manifest = cloneManifest();
  manifest.quality.runtime_dependency.sha256 = '0'.repeat(64);
  assert.throws(() => validateBundle(ROOT, manifest), /quality metadata drift/);
});

test('public-boundary drift fails closed', () => {
  const manifest = cloneManifest();
  manifest.public_boundary.local_paths_included = true;
  assert.throws(() => validateBundle(ROOT, manifest), /public boundary drift/);
});

test('an extra data file fails closed', () => {
  const actual = MANIFEST.records.map((record) => `${record.character}.json`);
  actual.push('未审核.json');
  assert.throws(() => validateDataFileSet(actual, MANIFEST.records), /data directory membership mismatch/);
});

test('a changed provenance line fails closed', () => {
  const original = readFileSync(resolve(ROOT, MANIFEST.provenance.snapshot_path));
  const changed = Buffer.from(original.toString('utf8').replace('"character":"抔"', '"character":"坏"'));
  const dataByCharacter = new Map(MANIFEST.records.map((record) => [
    record.character,
    JSON.parse(readFileSync(resolve(ROOT, record.data_path), 'utf8')),
  ]));
  assert.throws(() => validateProvenanceSnapshot(changed, MANIFEST, dataByCharacter), /SHA-256 mismatch/);
});
