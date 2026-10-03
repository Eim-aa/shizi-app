// 题面（M1-8，决定-D16 / R-W28）纯逻辑与视图树单测。
// - promptCopy() 从 src/config/copy 取值，必须与 cards.js PROMPT_COPY 逐字一致（门禁 promptHTML / visibleHint 字节一致）；
// - 全部 7294 张卡：格数 = 码点数、原位拼音、其余同一目标字 □、提示行 = 内容门禁 visibleHint、未揭示时目标字不进任何文本；
// - PromptView 的 vnode 树（无 hooks，直接展开）：任何属性值不含目标字、没有 dangerouslySetInnerHTML、文本都是文本子节点；
// - 补充平面字 𠮷、自定义「哈哈哈」、`<img onerror>` 字面量、缺拼音、揭示阶段。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_COPY, promptHTML, promptModel } from '../../src/core/cards.js';
import {
  promptCopy, promptCells, blankLabel, toneOfPinyin, PromptView, REVEAL_PHASES, cardForKey, setCardResolver, indexCards,
} from '../../src/ui/screens/write/prompt.js';
import { t } from '../../src/config/copy/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { loadCorpus } = require('../../scripts/content-corpus.cjs');

let corpusPromise = null;
const corpus = () => (corpusPromise ||= loadCorpus(ROOT));

const expectedTexts = card => card.chars.map((ch, i) => (i === card.ci ? (card.py || '？') : ch === card.target ? '□' : ch));
const repeatCount = card => card.chars.filter(ch => ch === card.target).length;

/** 展开 vnode 树（函数组件无 hooks 时直接调用），收集属性值与文本。 */
function walk(vnode, out = { attrs: [], texts: [], props: [] }) {
  if (vnode === null || vnode === undefined || typeof vnode === 'boolean') return out;
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    out.texts.push(String(vnode));
    return out;
  }
  if (Array.isArray(vnode)) {
    vnode.forEach(v => walk(v, out));
    return out;
  }
  const { type, props } = vnode;
  if (typeof type === 'function') return walk(type(props), out);
  for (const [name, value] of Object.entries(props || {})) {
    if (name === 'children') continue;
    out.props.push(name);
    if (value !== null && value !== undefined && typeof value !== 'function') out.attrs.push(`${name}=${String(value)}`);
  }
  walk(props && props.children, out);
  return out;
}

function renderTree(card, { revealed = false } = {}) {
  const model = promptCells(card, { revealed });
  return { model, tree: walk(PromptView({ model, hintId: 'sz-prompt-hint-test', groupLabel: t('X-PROMPT.groupLabel') })) };
}

test('promptCopy() comes from src/config/copy and is byte-identical to cards.js PROMPT_COPY', () => {
  const copy = promptCopy();
  assert.deepEqual(Object.keys(copy).sort(), Object.keys(PROMPT_COPY).sort(), 'same five keys as PROMPT_COPY');
  assert.deepEqual({ ...copy }, { ...PROMPT_COPY }, 'same values');
  assert.equal(copy.repeatInstruction, t('R-W28.repeatBlankNote'), 'R-W28 is the repeated-target instruction');
  assert.equal(copy.repeatBlankGlyph, '□', 'D16 □ (U+25A1)');
  assert.equal(t('X-PROMPT.groupLabel'), '题目');
});

test('all cards: gate promptHTML / visibleHint unchanged when rendered with copy from src/config/copy', async () => {
  const { cards } = await corpus();
  assert.equal(cards.length, 7294);
  let repeated = 0;
  for (const card of cards) {
    assert.equal(promptHTML(card, promptCopy()), card.promptHTML, `promptHTML bytes ${card.cardKey}`);
    assert.equal(promptModel(card, promptCopy()).visibleHint, card.visibleHint, `visibleHint ${card.cardKey}`);
    if (repeatCount(card) > 1) repeated += 1;
  }
  assert.ok(repeated > 0, 'corpus still has repeated-target cards to exercise');
});

// 题面组件可能出现的全部属性值（界面常量）。
const STATIC_ATTRS = new Set([
  'class=sz-write__prompt sz-prompt', 'role=group', `aria-label=${PROMPT_COPY.repeatBlankLabel}`, 'aria-label=题目',
  'aria-describedby=sz-prompt-hint-test', 'data-testid=write-prompt', 'data-single=true', 'data-single=false',
  'class=sz-prompt__wordwrap', 'class=sz-prompt__word', 'data-testid=write-prompt-word', 'class=sz-prompt__cell',
  'data-kind=text', 'data-kind=blank', 'data-kind=repeatBlank', 'data-masked=true', 'data-testid=write-prompt-cell',
  'class=sz-prompt__py', 'data-testid=write-prompt-py', 'class=sz-prompt__cross', 'aria-hidden=true', 'role=img',
  'class=sz-prompt__fill', 'class=sz-prompt__hint', 'id=sz-prompt-hint-test', 'aria-live=polite', 'data-testid=write-prompt-hint',
]);

test('all cards: cells per code point, blank shows pinyin, other targets □, no answer in any text or attribute', async () => {
  const { cards } = await corpus();
  const failures = [];
  const staticCollisions = [];
  for (const card of cards) {
    const { model, tree } = renderTree(card);
    const texts = model.cells.map(c => c.text);
    if (JSON.stringify(texts) !== JSON.stringify(expectedTexts(card))) failures.push([card.cardKey, 'cells', texts]);
    if (model.cells.length !== Array.from(card.word).length) failures.push([card.cardKey, 'codepoints']);
    const repeats = model.cells.filter(c => c.kind === 'repeatBlank');
    if (repeats.length !== repeatCount(card) - 1) failures.push([card.cardKey, 'repeat count']);
    if (!repeats.every(c => c.label === PROMPT_COPY.repeatBlankLabel)) failures.push([card.cardKey, 'repeat label']);
    if (model.cells.filter(c => c.kind === 'blank').length !== 1) failures.push([card.cardKey, 'one blank']);
    if (model.hint !== card.visibleHint) failures.push([card.cardKey, 'hint']);
    if (tree.texts.some(s => s.includes(card.target))) failures.push([card.cardKey, 'text leak']);
    // 属性与卡片无关：只能是固定集合里的值（界面常量）或 --n/--bi 版式变量——卡片内容（字、词、拼音、提示）从不进属性。
    // 例外：空格的读屏名称（A9）只由位置 + 拼音 + 声调决定（不含答案字）——下面单独断言。
    const blankName = model.cells.filter(c => c.kind === 'blank' && c.label).map(c => `aria-label=${c.label}`);
    const dynamic = tree.attrs.filter(a => !STATIC_ATTRS.has(a) && !blankName.includes(a) && !/^style=--n:\d+;--bi:\d+$/.test(a) && !/^key=\d+$/.test(a));
    if (dynamic.length) failures.push([card.cardKey, 'card-dependent attribute', dynamic]);
    const blankCell = model.cells.find(c => c.kind === 'blank');
    const idx = model.cells.indexOf(blankCell);
    if (card.py && blankCell.label !== blankLabel({ py: card.py, index: idx, count: model.cells.length })) failures.push([card.cardKey, 'blank label shape', blankCell.label]);
    if (card.py && !tree.attrs.includes(`aria-label=${blankCell.label}`)) failures.push([card.cardKey, 'blank label not rendered']);
    const staticWithTarget = tree.attrs.filter(a => !blankName.includes(a) && a.includes(card.target));
    if (staticWithTarget.length) staticCollisions.push([card.cardKey, staticWithTarget]);
    if (tree.props.includes('dangerouslySetInnerHTML')) failures.push([card.cardKey, 'innerHTML']);
    if (failures.length > 5) break;
  }
  assert.deepEqual(failures, []);
  // 界面常量里的字（「题目」「同一目标字的另一处空格」）与目标字同形只是巧合，不随卡片变化、不是泄漏；
  // 记下来以免将来有人把它当成新增问题（e2e 的全页检查对这些字另行豁免界面常量）。
  assert.deepEqual(staticCollisions.map(([k]) => k).sort(), ['base:目', 'base:题'], 'only 题 / 目 collide with the group label');
});

test('A9: blank cell reads 「要写的字，第 k 个，读 py，N 声」; single-char omits the position; revealed phases set no name', () => {
  const gan = { word: '干净', chars: ['干', '净'], ci: 0, target: '干', py: 'gān', hint: '', ctx: 'override' };
  assert.equal(promptCells(gan).cells[0].label, '要写的字，第 1 个，读 gān，一声');
  const jing = { word: '干净', chars: ['干', '净'], ci: 1, target: '净', py: 'jìng', hint: '', ctx: 'override' };
  assert.equal(promptCells(jing).cells[1].label, '要写的字，第 2 个，读 jìng，四声');
  const single = { word: '嚏', chars: ['嚏'], ci: 0, target: '嚏', py: 'tì', hint: '', ctx: 'gloss' };
  assert.equal(promptCells(single).cells[0].label, '要写的字，读 tì，四声');
  assert.ok(!promptCells(single).cells[0].label.includes('嚏'), 'recall label never carries the answer (D16)');
  // 揭示阶段格里是答案字的文本：不设 role=img / 名称（否则会把字藏起来，也不把答案放进属性）
  assert.equal(promptCells(single, { revealed: true }).cells[0].label, null);
  assert.equal(promptCells(gan, { revealed: true }).cells[0].label, null);
  // 其余格保持：普通字无 role / label，□ 保持原标签
  assert.equal(promptCells(gan).cells[1].label, null);
  const repeat = { word: '越来越', chars: Array.from('越来越'), ci: 0, target: '越', py: 'yuè', hint: '', ctx: 'override' };
  assert.equal(promptCells(repeat).cells[2].label, PROMPT_COPY.repeatBlankLabel);
  // 渲染：role=img + aria-label
  const { tree } = renderTree(gan);
  assert.ok(tree.attrs.includes('role=img') && tree.attrs.includes('aria-label=要写的字，第 1 个，读 gān，一声'));
  // 声调：符号 → 1–4，无符号 → 轻声；ü、nasal 音节
  const tones = { mā: 1, má: 2, mǎ: 3, mà: 4, ma: 5, lǖ: 1, lǘ: 2, lǚ: 3, lǜ: 4, nǚ: 3, ń: 2, ň: 3, ǹ: 4, '': 5 };
  for (const [py, tone] of Object.entries(tones)) assert.equal(toneOfPinyin(py), tone, py || '(empty)');
  // 缺拼音（占位「？」）：不给名称
  assert.equal(promptCells({ ...gan, py: '' }).cells[0].label, null);
});

test('view: role=group + aria-describedby → hint id; hint aria-live=polite; □ cells role=img with label', () => {
  const card = { word: '越来越', chars: Array.from('越来越'), ci: 0, target: '越', py: 'yuè', hint: '', ctx: 'override' };
  const { model, tree } = renderTree(card);
  assert.deepEqual(model.cells.map(c => c.text), ['yuè', '来', '□']);
  assert.equal(model.hint, PROMPT_COPY.repeatInstruction, 'repeat instruction shown');
  assert.ok(tree.attrs.includes('role=group'));
  assert.ok(tree.attrs.includes('aria-describedby=sz-prompt-hint-test'));
  assert.ok(tree.attrs.includes('id=sz-prompt-hint-test'));
  assert.ok(tree.attrs.includes('aria-live=polite'));
  assert.ok(tree.attrs.includes('role=img'));
  assert.ok(tree.attrs.includes(`aria-label=${PROMPT_COPY.repeatBlankLabel}`));
  assert.ok(tree.attrs.includes('aria-label=题目'));
  assert.ok(!tree.texts.join('').includes('越') && !tree.attrs.join('|').includes('越'));

  const slow = { word: '慢慢', chars: ['慢', '慢'], ci: 1, target: '慢', py: 'màn', hint: '', ctx: 'override' };
  assert.deepEqual(promptCells(slow).cells.map(c => [c.kind, c.text]), [['repeatBlank', '□'], ['blank', 'màn']]);
});

test('supplementary-plane target 𠮷 is one cell per code point', () => {
  const card = { word: '𠮷甲𠮷𠮷', chars: Array.from('𠮷甲𠮷𠮷'), ci: 2, target: '𠮷', py: 'jí', ctx: 'override', promptHint: '补充平面字符的合成显示测试。' };
  const { model, tree } = renderTree(card);
  assert.equal(model.cells.length, 4);
  assert.deepEqual(model.cells.map(c => c.text), ['□', '甲', 'jí', '□']);
  assert.equal(model.blankIndex, 2);
  assert.ok(![...tree.texts, ...tree.attrs].some(s => s.includes('𠮷')));
  assert.ok(![...tree.texts, ...tree.attrs].some(s => s.includes('\uD842')), 'no lone surrogate half leaks either');
});

test('custom 哈哈哈: custom hint + instruction, two □', () => {
  const card = { word: '哈哈哈', chars: ['哈', '哈', '哈'], ci: 0, target: '哈', py: 'hā', hint: '笑声', custom: true };
  const { model } = renderTree(card);
  assert.deepEqual(model.cells.map(c => c.text), ['hā', '□', '□']);
  assert.equal(model.hint, `笑声 ${PROMPT_COPY.repeatInstruction}`);
  assert.ok(model.hint.endsWith('空格里是同一个字，只写一次。'));
});

test('literal <img onerror> in a hint stays a text child (no innerHTML path)', () => {
  const evil = '<img id="content-injection" src=x onerror="window.__contentInjected=true">';
  const card = { word: '𠮷甲', chars: ['𠮷', '甲'], ci: 0, target: '𠮷', py: 'jí', ctx: 'override', promptHint: evil };
  const { model, tree } = renderTree(card);
  assert.equal(model.hint, evil);
  assert.ok(tree.texts.includes(evil), 'hint is a single text child');
  assert.ok(!tree.props.includes('dangerouslySetInnerHTML'));
});

test('missing pinyin → ？; empty card → empty model', () => {
  const card = { word: '一二', chars: ['一', '二'], ci: 1, target: '二', py: '', ctx: 'dict' };
  assert.deepEqual(promptCells(card).cells.map(c => c.text), ['一', '？']);
  assert.deepEqual(promptCells(null), { cells: [], hint: '', blankIndex: -1, count: 0 });
});

test('reveal phases fill the target; recall / retrace stay masked', () => {
  assert.deepEqual([...REVEAL_PHASES], ['compare', 'answer', 'trace']);
  const card = { word: '越来越', chars: Array.from('越来越'), ci: 0, target: '越', py: 'yuè', ctx: 'override' };
  const { model, tree } = renderTree(card, { revealed: true });
  assert.equal(model.cells[0].fill, '越');
  assert.equal(model.cells[0].text, 'yuè', 'pinyin stays above the filled blank');
  assert.equal(model.cells[2].text, '越');
  assert.equal(model.cells[2].label, null, 'revealed repeat cell is plain text (no img label)');
  assert.ok(!tree.attrs.join('|').includes('越'), 'even revealed, the answer is text only — never an attribute');
});

test('cardForKey: resolver first, then the deck globals (SEED / CONTEXT_OVERRIDES); custom keys not resolved', async () => {
  const { seed, overrides, cards } = await corpus();
  globalThis.SEED = seed;
  globalThis.CONTEXT_OVERRIDES = overrides;
  try {
    const yong = cardForKey('base:永');
    const expected = cards.find(c => c.cardKey === 'base:永');
    assert.equal(yong.word, expected.word);
    assert.equal(yong.ci, expected.ci);
    assert.equal(cardForKey('custom:永'), null);
    assert.equal(cardForKey(''), null);
    const fake = { word: '哈哈哈', chars: ['哈', '哈', '哈'], ci: 0, target: '哈', py: 'hā', hint: '', custom: true };
    setCardResolver(key => (key === 'custom:哈' ? fake : undefined));
    assert.equal(cardForKey('custom:哈'), fake);
    assert.equal(cardForKey('base:永').word, expected.word, 'undefined from resolver falls back to the deck');
  } finally {
    setCardResolver(null);
    delete globalThis.SEED;
    delete globalThis.CONTEXT_OVERRIDES;
  }
  const idx = indexCards([{ target: '甲', chars: ['甲'] }, { target: '甲', chars: ['甲', '乙'] }]);
  assert.equal(idx.get('base:甲').chars.length, 1, 'first card per key wins');
});
