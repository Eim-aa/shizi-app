// M2-0 查字 / 自己选字组件的 UI 层纯逻辑与视图（src/ui/components/query/*；决定-D21；04 R-Q04–R-Q06、R-Q08、R-H06）。
// 模型（sheetModel）、加入 commit（真 store + 内存 Storage + 故障注入）、回调失败判定、键盘避让计算、行 / 卡片 / 底栏视图。
import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetModel, commitAdd, isFailure, deckPredicates, ADD_LABEL, PickBar } from '../../src/ui/components/query/QuerySheet.js';
import { pickBar as pickBarOf } from '../../src/core/query.js';
import { CharRow } from '../../src/ui/components/query/CharRow.js';
import { CharCard, CardActions, CardFooter, CardSecondary, cardActionParts, BadCard, cardStatText, cardMetaText, cardInkPoints, formatDay } from '../../src/ui/components/query/CharCard.js';
import { keyboardInset, sheetFrameStyle, handOffFocus, focusProxyInput, createTextGate } from '../../src/ui/components/query/input.js';
import { openQuery, QUERY_OVERLAY } from '../../src/ui/components/query/index.js';
import { Button } from '../../src/ui/components/Button.js';
import { createStore } from '../../src/store/store.js';
import { createStorage } from '../../src/store/storage.js';
import { KEYS } from '../../src/core/schema.js';
import { encodeInk, buildStroke } from '../../src/core/ink-math.js';
import { t } from '../../src/config/copy/index.js';
import { MemoryStorage } from '../store/helpers.mjs';
import { readFileSync } from 'node:fs';

const NOW = new Date(2026, 8, 24, 12).getTime();
const AT = new Date(2026, 8, 24, 10).getTime();

function rec(id, char, judgment = 'correct') {
  return { id, cardKey: `base:${char}`, char, sessionId: 's1', kind: 'judged', judgment, at: AT, localDay: '2026-09-24',
    help: { hints: 0, answerSeen: false, traced: false } };
}

const DECK = { 永: { py: 'yǒng', word: '永远', strokes: 5, norm: '一级' }, 和: { py: 'hé', word: '和平', strokes: 8, norm: '一级' },
  犇: { py: 'bēn', word: '犇', strokes: 12, norm: '三级' } };
const lookup = key => DECK[key.slice(5)] || null;
const predicates = deckPredicates({ library: 'core3500' }, lookup);

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(n => walk(n, visit));
    return;
  }
  visit(node);
  walk(node.props && node.props.children, visit);
}
function byTestid(node) {
  const out = {};
  walk(node, n => {
    if (n.props && n.props['data-testid']) (out[n.props['data-testid']] ||= []).push(n);
  });
  return out;
}
function text(node) {
  let s = '';
  walk(node, n => {
    const c = n.props && n.props.children;
    if (typeof c === 'string' || typeof c === 'number') s += c;
    if (Array.isArray(c)) for (const x of c) if (typeof x === 'string' || typeof x === 'number') s += x;
  });
  return s;
}

// ---------------------------------------------------------------- 谓词与模型

test('deckPredicates: deck membership and current library (settings.library; unknown → default core3500)', () => {
  assert.equal(predicates.inDeck('犇'), true);
  assert.equal(predicates.inLibrary('犇'), false, '三级 not in core3500');
  assert.equal(predicates.inLibrary('永'), true);
  assert.equal(predicates.inDeck('龘'), false);
  assert.equal(deckPredicates(null, lookup).inLibrary('永'), true, 'no settings → default library');
  assert.equal(predicates.card('永').py, 'yǒng');
});

test('sheetModel pick: empty input → hint, 0 selected, bar「先选一个字」disabled (R-Q06)', () => {
  const m = sheetModel({ mode: 'pick', text: '', cur: '', selected: new Set(), state: null, predicates });
  assert.equal(m.view, 'hint');
  assert.deepEqual(m.chosen, []);
  assert.deepEqual(m.bar, { key: 'R-Q06.btnNone', vars: undefined, disabled: true });
});

test('sheetModel pick: typing selects nothing; selection filtered by input and practicability; bar label by count', () => {
  const typed = sheetModel({ mode: 'pick', text: '永和龘', cur: '', selected: new Set(), state: null, predicates });
  assert.equal(typed.view, 'rows');
  assert.deepEqual(typed.chosen, [], 'typing does not auto-select');
  assert.equal(typed.bar.disabled, true);
  const two = sheetModel({ mode: 'pick', text: '永和龘', cur: '', selected: new Set(['和', '永', '龘']), state: null, predicates });
  assert.deepEqual(two.chosen, ['永', '和'], 'input order; 龘 cannot be selected');
  assert.deepEqual(two.bar, { key: 'R-Q06.btnPracticeN', vars: { n: 2 }, disabled: false });
  const card = sheetModel({ mode: 'pick', text: '永', cur: '', selected: new Set(), state: null, predicates });
  assert.equal(card.view, 'card');
  assert.equal(card.bar, null, 'no bottom bar on the card');
});

test('sheetModel lookup: no selection, no bar; rows carry summaries from records / custom', () => {
  const state = { records: { '2026-09': [rec('r1', '永'), rec('r2', '永', 'wrong')] }, sched: {}, custom: { added: [{ char: '和', at: AT }] } };
  const m = sheetModel({ mode: 'lookup', text: '永和龘x', cur: '', selected: new Set(['永']), state, predicates });
  assert.equal(m.bar, null);
  assert.deepEqual(m.chosen, [], 'lookup never selects');
  assert.deepEqual(m.summaries.map(s => [s.char, s.count, s.custom, s.practicable]), [['永', 2, false, true], ['和', 0, true, true], ['龘', 0, false, false]]);
  assert.deepEqual(m.notes, [{ key: 'R-Q03.removed', vars: { n: 1 } }]);
  const opened = sheetModel({ mode: 'lookup', text: '永和龘x', cur: '龘', selected: new Set(), state, predicates });
  assert.equal(opened.view, 'bad');
  assert.equal(opened.summary.char, '龘');
  assert.equal(opened.multi, true);
});

// ---------------------------------------------------------------- 加入（D21：只在点「加入」时写）

function freshStore() {
  const backend = new MemoryStorage();
  const storage = createStorage(backend, { now: () => NOW });
  const store = createStore({ storage, now: () => NOW });
  store.load();
  return { store, storage, backend };
}

test('commitAdd: one commit writes custom.added once; re-adding writes nothing; failure publishes nothing and retry works', () => {
  const { store, storage, backend } = freshStore();
  const writes = () => backend.writeCount;
  const w0 = writes();
  const r1 = commitAdd(store, '永');
  assert.equal(r1.ok, true);
  assert.deepEqual(store.getState().custom, { added: [{ char: '永', at: NOW }] });
  assert.ok(backend.getItem(KEYS.custom).includes('永'), 'persisted to shizi.v2.custom');
  const w1 = writes();
  assert.ok(w1 > w0, 'wrote');
  const r2 = commitAdd(store, '永');
  assert.equal(r2.ok, true);
  assert.equal(writes(), w1, 'already added → no storage write');
  storage.failNextWrite(1, { kind: 'generic', matchKey: KEYS.custom });
  const r3 = commitAdd(store, '和');
  assert.equal(r3.ok, false, 'failure reported (三段式)');
  assert.deepEqual(store.getState().custom.added.map(e => e.char), ['永'], 'nothing published on failure');
  assert.deepEqual(JSON.parse(backend.getItem(KEYS.custom)).added.map(e => e.char), ['永'], 'storage rolled back');
  const r4 = commitAdd(store, '和');
  assert.equal(r4.ok, true);
  assert.deepEqual(store.getState().custom.added.map(e => e.char), ['永', '和']);
  assert.equal(ADD_LABEL, 'query:add');
});

test('isFailure: {ok:false} (sync or async) and thrown / rejected callbacks are failures; anything else is not', async () => {
  assert.equal(await isFailure({ ok: false }), true);
  assert.equal(await isFailure(Promise.resolve({ ok: false })), true);
  assert.equal(await isFailure(Promise.reject(new Error('x'))), true);
  assert.equal(await isFailure(undefined), false);
  assert.equal(await isFailure({ ok: true }), false);
  assert.equal(await isFailure(Promise.resolve('started')), false);
});

// ---------------------------------------------------------------- 键盘避让与焦点

test('keyboardInset / sheetFrameStyle: sheet sits on the visible-area bottom and sizes to it (visualViewport)', () => {
  assert.equal(keyboardInset({ innerHeight: 852 }, { height: 852, offsetTop: 0 }), 0);
  assert.equal(keyboardInset({ innerHeight: 852 }, { height: 516, offsetTop: 0 }), 336);
  assert.equal(keyboardInset({ innerHeight: 852 }, { height: 516, offsetTop: 40 }), 296, 'page scrolled by iOS');
  assert.equal(keyboardInset({ innerHeight: 852 }, null), 0);
  const open = sheetFrameStyle({ inset: 336, height: 516, top: 0 });
  assert.deepEqual([open.bottom, open.maxHeight, open.minHeight, open.paddingBottom, open.pb], ['336px', '454px', '330px', '16px', '16px']);
  const closed = sheetFrameStyle({ inset: 0, height: 852, top: 0 });
  assert.equal(closed.bottom, '0px');
  assert.equal(closed.paddingBottom, '', 'default safe-area padding when the keyboard is closed');
  assert.equal(sheetFrameStyle(null).minHeight, '64%');
});

test('focus proxy: no DOM → no-op; openQuery rejects unknown modes before touching the router (P42)', () => {
  assert.equal(focusProxyInput(null), null);
  assert.equal(handOffFocus(null, null), false);
  assert.throws(() => openQuery({ mode: 'add' }), RangeError);
  assert.equal(QUERY_OVERLAY, 'query');
});

// ---------------------------------------------------------------- F6 输入法选字后立即出结果

function gateRun(initial = '') {
  const got = [];
  const gate = createTextGate(v => got.push(v), initial);
  const el = { value: '' };
  const ev = (isComposing = false) => ({ target: el, currentTarget: el, isComposing });
  return { got, gate, el, ev };
}

test('F6 createTextGate, WebKit order: input(isComposing=true) then only compositionend → reports the final value once at compositionend', () => {
  const { got, gate, el, ev } = gateRun();
  gate.onCompositionStart(ev());
  el.value = 'c';
  gate.onInput(ev(true));
  el.value = 'chun';
  gate.onInput(ev(true));
  assert.deepEqual(got, [], 'pinyin letters are not reported while composing');
  el.value = '春';
  gate.onInput(ev(true));
  assert.deepEqual(got, [], 'still composing at the picking input');
  gate.onCompositionEnd(ev());
  assert.deepEqual(got, ['春'], 'compositionend reports the final value');
});

test('F6 createTextGate, Chromium order: compositionend then input(isComposing=false) → reported once (deduped)', () => {
  const { got, gate, el, ev } = gateRun();
  gate.onCompositionStart(ev());
  el.value = 'xia';
  gate.onInput(ev(true));
  el.value = '夏';
  gate.onInput(ev(true));
  gate.onCompositionEnd(ev());
  gate.onInput(ev(false));
  assert.deepEqual(got, ['夏'], 'the trailing input with the same value does not report again');
});

test('F6 createTextGate: input before compositionend (WebKit, isComposing=false) and compositionend-before-value orders report each distinct value', () => {
  const a = gateRun();
  a.gate.onCompositionStart(a.ev());
  a.el.value = '春';
  a.gate.onInput(a.ev(false)); // isComposing 已经是 false 但 compositionend 还没来：仍在组字中，不报
  assert.deepEqual(a.got, []);
  a.gate.onCompositionEnd(a.ev());
  assert.deepEqual(a.got, ['春']);
  // compositionend 先于最终值落地（值还是旧的）→ 随后的 input 补上
  const b = gateRun();
  b.gate.onCompositionStart(b.ev());
  b.el.value = 'chun';
  b.gate.onInput(b.ev(true));
  b.gate.onCompositionEnd(b.ev()); // 此刻值仍是 'chun'：照原文上报（不按拼音字母过滤，由弹层的 filterInput 决定）
  b.el.value = '春';
  b.gate.onInput(b.ev(true)); // WebKit 个别版本 compositionend 之后的 input 仍带 isComposing=true：已见过 compositionstart，按标志判断，不再过滤
  assert.deepEqual(b.got, ['chun', '春']);
});

test('F6 createTextGate: plain typing reports each change, ignores same value, honours isComposing when no compositionstart was ever seen', () => {
  const { got, gate, el, ev } = gateRun('春');
  el.value = '春';
  gate.onInput(ev());
  assert.deepEqual(got, [], 'same as the initial value → nothing');
  el.value = '春夏';
  gate.onInput(ev());
  el.value = '春夏';
  gate.onInput(ev());
  el.value = '';
  gate.onInput(ev());
  assert.deepEqual(got, ['春夏', '']);
  const solo = gateRun();
  solo.el.value = 'ni';
  solo.gate.onInput(solo.ev(true));
  assert.deepEqual(solo.got, [], 'isComposing=true without compositionstart is still composing');
});

test('F6 QueryInput wires composition events in lowercase (Preact would listen for a case-sensitive "CompositionEnd" that never fires)', () => {
  const src = readFileSync(new URL('../../src/ui/components/query/input.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /onComposition(Start|End|Update)=/, 'camelCase composition props are never delivered by Preact');
  assert.match(code, /oncompositionstart=/);
  assert.match(code, /oncompositionend=/);
});

// ---------------------------------------------------------------- 视图

test('CharRow lookup: no checkbox; status text; opens the card', () => {
  let opened = null;
  const node = CharRow({ summary: { char: '永', practicable: true, custom: false, count: 2 }, pinyin: 'yǒng', word: '永远',
    selectable: false, onOpen: c => { opened = c; } });
  const ids = byTestid(node);
  assert.equal(ids['query-row-select'], undefined, 'no checkbox in lookup');
  assert.equal(ids['query-row'][0].props['data-selected'], undefined);
  assert.equal(text(ids['query-row-status'][0]), t('R-Q04.rowCount', { n: 2 }));
  ids['query-row-open'][0].props.onClick();
  assert.equal(opened, '永');
});

test('CharRow pick: checkbox is a Button role=checkbox with aria-checked + aria-label; unpracticable rows have none', () => {
  let toggled = null;
  const off = byTestid(CharRow({ summary: { char: '和', practicable: true, custom: true, count: 0 }, selectable: true, selected: false,
    onToggle: c => { toggled = c; } }));
  const sel = off['query-row-select'][0];
  assert.equal(sel.type, Button);
  assert.equal(sel.props.role, 'checkbox');
  assert.equal(sel.props['aria-checked'], 'false');
  assert.equal(sel.props['aria-label'], '选择「和」');
  sel.props.onClick();
  assert.equal(toggled, '和');
  assert.equal(text(off['query-row-status'][0]), '自选的字 · 还没有记录');
  const on = byTestid(CharRow({ summary: { char: '和', practicable: true, custom: false, count: 0 }, selectable: true, selected: true }));
  assert.equal(on['query-row-select'][0].props['aria-checked'], 'true');
  assert.equal(on['query-row-select'][0].props['aria-label'], '取消选择「和」');
  const bad = byTestid(CharRow({ summary: { char: '龘', practicable: false, custom: false, count: 0 }, selectable: false }));
  assert.equal(bad['query-row-select'], undefined);
  assert.equal(bad['query-row'][0].props['data-practicable'], 'false');
  assert.equal(text(bad['query-row-status'][0]), '暂时不能练');
});

test('PickBar: 0 selected → Button disabled (Button adds aria-disabled); N → label; failure → R-H06 三段式', () => {
  const none = byTestid(PickBar({ bar: pickBarOf(0), count: 0 }));
  assert.equal(none['query-bar'][0].props['data-count'], 0);
  assert.equal(none['query-go'][0].type, Button);
  assert.equal(none['query-go'][0].props.disabled, true);
  assert.equal(text(none['query-go'][0]), '先选一个字');
  const two = byTestid(PickBar({ bar: pickBarOf(2), count: 2 }));
  assert.equal(two['query-go'][0].props.disabled, false);
  assert.equal(text(two['query-go'][0]), '练这 2 个字');
  const failed = byTestid(PickBar({ bar: pickBarOf(2), count: 2, failed: true }));
  assert.equal(failed['query-go'], undefined);
  assert.equal(text(failed['query-go-fail-cancel'][0]), '先不保存');
  assert.equal(text(failed['query-go-fail-retry'][0]), '再试一次');
  assert.equal(PickBar({ bar: null, count: 0 }), null, 'no bar outside pick hint / rows');
});

test('CardActions: add / already added / detail greyed without onDetail; add failure 三段式; practice failure R-H06', () => {
  const summary = { char: '永', practicable: true, custom: false, count: 2, latest: rec('r2', '永'), latestDay: '2026-09-24' };
  const normal = byTestid(CardActions({ summary }));
  assert.equal(text(normal['query-card-practice'][0]), '练这个字');
  assert.equal(text(normal['query-card-add'][0]), '加入自选的字');
  assert.equal(normal['query-card-add'][0].props.disabled, false);
  assert.equal(normal['query-card-detail'][0].props.disabled, true, '查看记录 greyed before M3-6');
  assert.equal(normal['query-card-in-custom'], undefined);
  const added = byTestid(CardActions({ summary: { ...summary, custom: true }, canDetail: true }));
  assert.equal(added['query-card-add'], undefined);
  assert.equal(added['query-card-in-custom'][0].props.disabled, true, '已在自选的字里 is a disabled button');
  assert.equal(text(added['query-card-in-custom'][0]), '已在自选的字里');
  assert.equal(added['query-card-detail'][0].props.disabled, false);
  const noRec = byTestid(CardActions({ summary: { ...summary, count: 0 } }));
  assert.equal(noRec['query-card-detail'], undefined, 'no record → no 查看记录');
  // 失败块是无 hook 的函数组件（FailBlock），展开后再查。
  const expand = (node, testid) => {
    let hit = null;
    walk(node, n => { if (n.props && n.props.testid === testid) hit = n; });
    return hit ? byTestid(hit.type(hit.props)) : null;
  };
  let retried = 0;
  const failedNode = CardActions({ summary, addFailed: true, onAdd: () => { retried += 1; } });
  assert.equal(byTestid(failedNode)['query-card-add'], undefined, 'add button replaced by the failure block');
  const failed = expand(failedNode, 'query-card-add-fail');
  assert.ok(failed && failed['query-card-add-fail']);
  assert.equal(text(failed['query-card-add-fail-cancel'][0]), '先不加');
  assert.equal(text(failed['query-card-add-fail-retry'][0]), '再试一次');
  assert.ok(text(failed['query-card-add-fail'][0]).includes('没加进自选的字，输入的字还在。'));
  failed['query-card-add-fail-retry'][0].props.onClick();
  assert.equal(retried, 1, '再试一次 = add again');
  const pf = expand(CardActions({ summary, practiceFailed: true }), 'query-card-practice-fail');
  assert.equal(text(pf['query-card-practice-fail-cancel'][0]), '先不保存');
  assert.equal(text(pf['query-card-practice-fail-retry'][0]), '再试一次');
  assert.ok(text(pf['query-card-practice-fail'][0]).includes('没保存上，输入的字还在。'));
  // 卡片文字
  assert.equal(cardStatText(summary), '记录了 2 次 · 最近一次 9 月 24 日');
  assert.equal(cardStatText({ ...summary, count: 0, latestDay: null }), '还没有记录');
  assert.equal(cardMetaText('yǒng', 5), 'yǒng · 5 画');
  assert.equal(cardMetaText('yǒng', 0), 'yǒng');
  assert.equal(formatDay('2026-09-24'), '9 月 24 日');
  assert.equal(typeof CharCard, 'function');
});

test('F5: card actions split — primary 「练这个字」 goes to the pinned footer, add / detail stay with the scrolling content; failures take over the footer', () => {
  const summary = { char: '春', practicable: true, custom: false, count: 1, latest: rec('r1', '春'), latestDay: '2026-09-24' };
  const parts = cardActionParts({ summary, canDetail: true });
  const primary = byTestid(parts.primary);
  assert.equal(text(primary['query-card-practice'][0]), '练这个字');
  assert.equal(primary['query-card-add'], undefined, 'primary part has only the main action');
  const rest = byTestid(parts.rest);
  assert.equal(text(rest['query-card-add'][0]), '加入自选的字');
  assert.equal(text(rest['query-card-detail'][0]), '查看记录');
  assert.equal(rest['query-card-practice'], undefined);
  // CardActions 仍是两块的合并（结构不变）
  const both = byTestid(CardActions({ summary, canDetail: true }));
  assert.ok(both['query-card-practice'] && both['query-card-add'] && both['query-card-detail']);
  // 底部固定区：正常是主按钮；失败三段式替换它；次要区在失败时不画
  assert.ok(byTestid(CardFooter({ summary }))['query-card-practice']);
  const addFail = CardFooter({ summary, addFailed: true });
  assert.equal(byTestid(addFail)['query-card-practice'], undefined);
  assert.equal(CardSecondary({ summary, addFailed: true }), null);
  assert.equal(CardSecondary({ summary, practiceFailed: true }), null);
  assert.ok(byTestid(CardSecondary({ summary }))['query-card-add']);
});

test('cardInkPoints: latest judged record ink (P19 latest); none when getInk has nothing or policy says otherwise', () => {
  const summary = { latest: rec('r2', '永') };
  assert.equal(cardInkPoints(summary, () => null), null, 'perRecordInk off → no ink');
  assert.equal(cardInkPoints({ latest: null }, () => ({})), null);
  const raw = [{ x: 60, y: 170, t: 0 }, { x: 170, y: 171, t: 60 }, { x: 280, y: 172, t: 120 }];
  const ink = encodeInk([buildStroke(raw, { final: true })]);
  const pts = cardInkPoints(summary, () => ink);
  assert.ok(Array.isArray(pts) && pts.length === 1 && pts[0].length > 1, 'decoded + resampled points');
  assert.equal(cardInkPoints(summary, () => ink, { queryCardInk: 'none' }), null);
});

test('BadCard: three can\'t-practise lines; 查看记录 only with records, greyed without onDetail', () => {
  const none = byTestid(BadCard({ summary: { char: '龘', count: 0 } }));
  assert.equal(text(none['query-bad-title'][0]), '「龘」暂时不能练。');
  assert.equal(text(none['query-bad-reason'][0]), '拾字还没有这个字的参考字形。');
  assert.equal(text(none['query-bad-source'][0]), '能练的字参考教育部《通用规范汉字表》，个别字暂时还不能练。');
  assert.equal(none['query-card-detail'], undefined);
  const withRec = byTestid(BadCard({ summary: { char: '龘', count: 1 }, canDetail: false }));
  assert.equal(withRec['query-card-detail'][0].props.disabled, true);
  const enabled = byTestid(BadCard({ summary: { char: '龘', count: 1 }, canDetail: true, onDetail: () => {} }));
  assert.equal(enabled['query-card-detail'][0].props.disabled, false);
});
