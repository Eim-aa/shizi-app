// 卡 C1（D50 ③）：语境词按顾问审读 1.0 替换并全库排查后，替换掉的敏感词做成禁用词表（scripts/fixtures/content-blocklist.json），
// 内容门禁（scripts/verify_content_corpus.cjs）与这里都检查题面可见文字（语境词、提示、释义）不含这些词，防止重新生成题库时回潮。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { loadCorpus, blocklistWords, blockedWordHits } = require(path.join(ROOT, 'scripts/content-corpus.cjs'));
const blocklist = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/content-blocklist.json'), 'utf8'));
const approval = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/content-quality-approved.json'), 'utf8'));
const WORDS = blocklistWords(blocklist);

// 合规说明 §4.1 点名的词 + 顾问审读点名必须发布前改的词
const NAMED = ['妓女', '娼妓', '狎妓', '嫖娼', '老鸨', '奸淫', '赌博', '杀人', '屠杀', '杀戮', '尸体', '僵尸', '死囚', '掐死', '拉屎',
  '梅毒', '天安门', '万岁', '河蟹', '蒋介石', '林彪', '慈禧', '段祺瑞', '彭德怀', '潘粤明'];

test('the blocklist holds every named sensitive word, grouped by category, without duplicates', () => {
  assert.ok(WORDS.length >= 200, `${WORDS.length} words`);
  assert.equal(new Set(WORDS).size, WORDS.length);
  for (const w of NAMED) assert.ok(WORDS.includes(w), w);
  for (const cat of ['name', 'political', 'sexual', 'stigma', 'compliance']) assert.ok(blocklist.categories[cat]?.words.length > 0, cat);
});

test('no prompt in the shipped corpus shows a blocked word (word, hint or gloss)', async () => {
  const { cards } = await loadCorpus(ROOT);
  assert.deepEqual(blockedWordHits(cards, WORDS), []);
  const by = new Map(cards.map(c => [c.target, c]));
  assert.equal(by.get('梅').word, '梅花');
  assert.equal(by.get('安').word, '平安');
  assert.equal(by.get('妓').ctx, 'gloss', 'no neutral word for 妓: a shape-only gloss');
  assert.ok(!/卖淫|生殖/.test(by.get('妓').visibleHint + by.get('茎').visibleHint));
});

test('a regenerated deck that brings a blocked word back is caught (word, promptHint and gloss)', async () => {
  const { cards } = await loadCorpus(ROOT, { sourcePatches: { 梅: { ans: '梅毒', ci: 0 } }, overrides: {} });
  assert.ok(blockedWordHits(cards, WORDS).some(h => h.target === '梅' && h.word === '梅毒'));
  const fake = [
    { target: '甲', word: '甲壳', promptHint: '和蒋介石有关', ctx: 'override', visibleHint: '' },
    { target: '乙', word: '乙', hint: '天安门旁', ctx: 'gloss', visibleHint: '' },
  ];
  assert.deepEqual(blockedWordHits(fake, WORDS).map(h => h.word), ['蒋介石', '天安门']);
});

test('round 4 approvals (C1): reading pinned, target exactly once, every replaced word recorded with its previous word', () => {
  const round4 = approval.entries.filter(e => e.round === 4);
  assert.ok(round4.length >= 480);
  for (const e of round4) {
    assert.ok(e.previous && e.previous.word, `${e.target}: previous word recorded`);
    assert.ok(e.override.py, `${e.target}: reading pinned`);
    if (e.override.w) assert.equal(Array.from(e.override.w).filter(c => c === e.target).length, 1, `${e.target} once in ${e.override.w}`);
    else assert.ok(e.override.gloss && !e.override.gloss.includes(e.target), `${e.target}: gloss without the answer`);
    assert.ok(e.reason && e.sources.length === 1);
  }
});
