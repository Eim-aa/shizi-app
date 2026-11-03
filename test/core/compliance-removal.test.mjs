// 卡 C1（D50 ①）：来源授权有问题的 76 个补充字从题库与笔顺数据里移除（合规说明 §1.8–§1.10、附录 B；
// 记录与回执见 audit/compliance-2026-10/）。
//   这 76 个字不在 deck.json 的 seed / groups / overrides、data/<字>.json、新字顺序里；𬇕（霞鹜文楷 GB 轮廓，OFL）保留。
//   （旧记录降级路径由 Swift 测试守；D84 起此处只留数据面。）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLED = path.join(ROOT, 'ios/ShiziCore/Sources/ShiziCore/Bundled');
const CHAR_ORDER = JSON.parse(fs.readFileSync(path.join(BUNDLED, 'char-order.json'), 'utf8'));

const receipt = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/compliance-2026-10/source-removal-76.receipt.json'), 'utf8'));
const REMOVED = receipt.removed.map(row => row.character);

const DECK = JSON.parse(fs.readFileSync(path.join(BUNDLED, 'deck.json'), 'utf8')); // D84：题库读 ShiziCore 的 deck.json


test('the 76 source-problem characters are gone from the deck, the stroke data and the new-character order; 𬇕 stays', () => {
  assert.equal(REMOVED.length, 76);
  assert.equal(new Set(REMOVED).size, 76);
  assert.equal(receipt.removed.filter(r => r.source_group === 'strokeorder_cc').length, 59);
  assert.equal(receipt.removed.filter(r => r.source_group === 'moe_stroke_order').length, 10);
  assert.equal(receipt.removed.filter(r => r.source_group === 'stkaiti_outline').length, 7);
  const targets = new Set(DECK.seed.map(row => row.target));
  const ordered = new Set([...CHAR_ORDER.order, ...CHAR_ORDER.level2, ...CHAR_ORDER.warmup]);
  for (const ch of REMOVED) {
    assert.ok(!targets.has(ch), `SEED still has ${ch}`);
    assert.ok(!(ch in DECK.groups), `GROUPS still has ${ch}`);
    assert.ok(!(ch in DECK.overrides), `context overrides still have ${ch}`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'data', `${ch}.json`)), `data/${ch}.json still ships`);
    assert.ok(!ordered.has(ch), `char-order still lists ${ch}`);
  }
  assert.equal(DECK.seed.length, 7218);
  assert.equal(Object.keys(DECK.groups).length, 7218);
  assert.ok(targets.has('𬇕') && fs.existsSync(path.join(ROOT, 'data', '𬇕.json')), '𬇕 (LXGW WenKai GB outline, OFL) is kept');
  const manifest = fs.readFileSync(path.join(ROOT, 'scripts/app-bundle-manifest.txt'), 'utf8').split('\n'); // D84：随 App 分发的清单
  for (const ch of REMOVED) assert.ok(!manifest.includes(`data/${ch}.json`), `app bundle manifest still lists data/${ch}.json`);
});
