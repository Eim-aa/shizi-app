// src/core/cards.js：纯模块约束、buildCards 数量与字段、四库计数、cardKey、promptModel / promptHTML（决定-D16）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  LIBRARIES, PROMPT_COPY, applyContextOverride, buildCards, cardKey, libraryById, libraryIdsFor,
  promptHTML, promptModel, visibleHint,
} from '../../src/core/cards.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

// 与页面相同：经典脚本在同一全局作用域求值，const 全局通过词法作用域取出（JSON 往返成主 realm 对象）。
function loadClassicGlobals() {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const run = (code, filename) => new vm.Script(code, { filename }).runInContext(context, { timeout: 5000 });
  run(read('deck-data.js'), 'deck-data.js');
  run(read('data/context-overrides.js'), 'data/context-overrides.js');
  return {
    seed: JSON.parse(run('JSON.stringify(SEED)', 'seed')),
    overrides: JSON.parse(run('JSON.stringify(CONTEXT_OVERRIDES)', 'overrides')),
  };
}

const { seed, overrides } = loadClassicGlobals();
const cards = buildCards({ seed, overrides });
const rawCards = buildCards({ seed, overrides: {} });
const byTarget = list => new Map(list.map(card => [card.target, card]));
const withOverrides = byTarget(cards);
const withoutOverrides = byTarget(rawCards);

test('cards.js is a pure module (no browser globals, storage or network)', () => {
  const source = read('src/core/cards.js');
  assert.doesNotMatch(source, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.|\bwindow\.|\bnavigator\.|\bfetch\(|\bXMLHttpRequest\b|\brequire\(/);
  assert.doesNotMatch(source, /^\s*import\s/m, 'core/cards.js has no imports');
});

test('buildCards yields one card per SEED row: 7218 unique targets', () => {
  assert.equal(seed.length, 7218);
  assert.equal(cards.length, 7218);
  assert.equal(new Set(cards.map(card => card.target)).size, 7218);
  assert.deepEqual(cards.map(card => card.target), seed.map(row => row.target), 'SEED order preserved');
  assert.equal(rawCards.length, 7218);
});

test('card fields and key order match the legacy CARDS construction', () => {
  const legacyKeys = ['word', 'chars', 'ci', 'target', 'py', 'hint', 'rank', 'strokes', 'parts', 'topic', 'd',
    'band', 'edu', 'common', 'norm', 'std', 'ctx'];
  for (const card of cards) {
    const keys = Object.keys(card);
    assert.deepEqual(keys.slice(0, legacyKeys.length), legacyKeys, card.target);
    assert.ok(keys.length === legacyKeys.length || (keys.length === legacyKeys.length + 1 && keys.at(-1) === 'promptHint'), card.target);
    assert.equal(card.chars.join(''), card.word);
    assert.equal(card.chars[card.ci], card.target);
  }
  const plain = withoutOverrides.get('越');
  assert.deepEqual(plain, {
    word: '越来越', chars: ['越', '来', '越'], ci: 0, target: '越', py: 'yuè',
    hint: '一级 · 书写进阶 · 常用语境 · 12画 · 3个部件 · 字频#440', rank: 440, strokes: 12, parts: 3,
    topic: '动作', d: 58, band: '进阶', edu: '表一', common: 5, norm: '一级', std: 2514, ctx: 'dict',
  });
});

test('LIBRARIES: legacy ids, v10 labels, counts 3500/2974/744/2500', () => {
  assert.deepEqual(LIBRARIES.map(lib => lib.id), ['core3500', 'adv3000', 'rare', 'curriculum2500']);
  assert.deepEqual(LIBRARIES.map(lib => lib.label), ['常用字', '次常用字', '少见字', '课本字']);
  assert.deepEqual(LIBRARIES.map(lib => lib.officialTotal), [3500, 3000, 1605, 2500]);
  const counts = Object.fromEntries(LIBRARIES.map(lib => [lib.id, cards.filter(lib.test).length]));
  assert.deepEqual(counts, { core3500: 3500, adv3000: 2974, rare: 744, curriculum2500: 2500 });
  assert.ok(Object.isFrozen(LIBRARIES) && LIBRARIES.every(Object.isFrozen));
  assert.equal(libraryById('rare').label, '少见字');
  assert.equal(libraryById('primary'), null);
  assert.deepEqual(libraryIdsFor(withOverrides.get('她')), ['core3500', 'curriculum2500']);
});

test('cardKey is base:<字> / custom:<字>', () => {
  assert.equal(cardKey(withOverrides.get('越')), 'base:越');
  assert.equal(cardKey({ target: '𠮷', custom: true }), 'custom:𠮷');
  assert.equal(new Set(cards.map(cardKey)).size, 7218);
});

test('promptModel masks every occurrence of a repeated target (越来越, raw SEED)', () => {
  const model = promptModel(withoutOverrides.get('越'));
  assert.deepEqual(model.segments, [
    { kind: 'blank', text: 'yuè' },
    { kind: 'text', text: '来' },
    { kind: 'repeatBlank', text: '□', label: PROMPT_COPY.repeatBlankLabel },
  ]);
  assert.equal(model.instruction, '空格里是同一个字，只写一次。');
  assert.equal(model.contentHint, '');
  assert.equal(model.visibleHint, '空格里是同一个字，只写一次。');
  assert.equal(promptHTML(withoutOverrides.get('越')),
    '<span class="blank">yuè</span><span class="given">来</span><span class="blank repeatBlank" role="img" aria-label="同一个字的另一处空格">□</span>');
});

test('promptModel for 慢慢 (raw SEED): only the original position carries pinyin', () => {
  const model = promptModel(withoutOverrides.get('慢'));
  assert.deepEqual(model.segments.map(s => s.kind), ['blank', 'repeatBlank']);
  assert.equal(model.segments[0].text, 'màn');
  assert.ok(model.segments.every(s => s.text !== '慢' && s.label !== '慢'));
});

test('#175 overrides replace 越来越/慢慢 and keep masking other repeated words (忠心耿耿)', () => {
  assert.equal(withOverrides.get('越').word, '越野');
  assert.equal(withOverrides.get('慢').word, '缓慢');
  assert.equal(promptModel(withOverrides.get('越')).instruction, '');
  const model = promptModel(withOverrides.get('耿'));
  assert.deepEqual(model.segments.map(s => s.kind), ['text', 'text', 'blank', 'repeatBlank']);
  assert.equal(model.visibleHint.endsWith(PROMPT_COPY.repeatInstruction), true);
});

test('no prompt or visible hint leaks the target; exactly one pinyin blank per card', () => {
  for (const card of cards) {
    const html = promptHTML(card);
    const model = promptModel(card);
    assert.ok(!html.includes(card.target), card.target);
    assert.ok(!model.visibleHint.includes(card.target), card.target);
    assert.equal(model.segments.filter(s => s.kind === 'blank').length, 1, card.target);
    assert.equal(model.segments.filter(s => s.kind !== 'text').length, card.chars.filter(ch => ch === card.target).length);
    assert.ok(model.segments.every(s => s.kind === 'text' || (s.text !== card.target && s.label !== card.target)));
  }
});

test('visible hint: gloss, promptHint, fallback, custom', () => {
  assert.equal(visibleHint(withOverrides.get('她')), '书面语中，指称女性的第三人称代词。');
  assert.equal(visibleHint(withOverrides.get('娘')), '指年轻女子。');
  assert.equal(visibleHint(withOverrides.get('欤')), '这个字暂时没有常用词，按拼音写就好');
  assert.equal(visibleHint({ custom: true, hint: '自定义', chars: ['哈', '哈'], ci: 0, target: '哈', py: 'hā' }),
    '自定义 空格里是同一个字，只写一次。');
  assert.equal(visibleHint({ custom: true, chars: ['字'], ci: 0, target: '字', py: 'zì' }), '');
});

test('promptHTML escapes markup and falls back to ？ without pinyin', () => {
  const card = { chars: ['<', '字', '&'], ci: 1, target: '字', py: '' };
  assert.equal(promptHTML(card), '<span class="given">&lt;</span><span class="blank">？</span><span class="given">&amp;</span>');
  const copy = { ...PROMPT_COPY, repeatInstruction: 'X' };
  assert.equal(promptModel({ chars: ['a', 'a'], ci: 0, target: 'a', py: 'p' }, copy).instruction, 'X');
});

test('applyContextOverride: invalid w is ignored, gloss/preserveCommon/py/promptHint semantics', () => {
  const row = seed.find(r => r.target === '越');
  assert.equal(applyContextOverride(row, { 越: { w: '不含', ci: 0 } }), row, 'invalid override returns the source row');
  const same = applyContextOverride(row, { 越: { w: '越来越', ci: 0, py: ' yuè ', promptHint: ' 提示 ' } });
  assert.equal(same.ctx, 'dict', 'identical context keeps its ctx');
  assert.equal(same.py, 'yuè');
  assert.equal(same.promptHint, '提示');
  const gloss = applyContextOverride({ ...row, common: 0 }, { 越: { gloss: '释义', preserveCommon: true } });
  assert.deepEqual([gloss.ans, gloss.ci, gloss.ctx, gloss.hint, gloss.common], ['越', 0, 'gloss', '释义', 0]);
  assert.equal(applyContextOverride({ ...row, common: 0 }, { 越: { gloss: '释义' } }).common, 1);
  assert.equal(applyContextOverride({ ...row, common: 0 }, { 越: { boost: true } }).common, 1.2);
  assert.equal(row.ans, '越来越', 'source row not mutated');
  assert.throws(() => buildCards({}), TypeError);
});
