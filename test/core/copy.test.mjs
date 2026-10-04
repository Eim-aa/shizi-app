import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PATHS,
  run,
  extractSection41,
  quotedSegments,
  normalizeRaw,
  checkSource,
  checkCopy,
  scopeFilter,
  flattenSource,
} from '../../scripts/verify_copy.mjs';
import { COPY, SCREENS, t, format, has } from '../../src/config/copy/index.js';

const source = JSON.parse(fs.readFileSync(PATHS.source, 'utf8'));
const markdown = fs.readFileSync(PATHS.requirements, 'utf8');
const clone = (x) => JSON.parse(JSON.stringify(x));
const cloneScreens = () => Object.fromEntries(Object.entries(SCREENS).map(([k, v]) => [k, { ...v }]));

test('copy: verify_copy passes on the whole declared scope', async () => {
  const result = await run({ scope: 'all' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.checked, result.total);
  assert.ok(result.total > 300);
});

test('copy: 04 §4.1 extraction sees every requirement row and nested 「」', () => {
  const rows = extractSection41(markdown);
  assert.ok(rows.length >= 130, String(rows.length));
  assert.equal(rows[0].id, 'R-H01');
  assert.ok(rows.some((r) => r.id === 'R-G10'));
  assert.deepEqual(quotedSegments('按钮「「X」记为写对 · 修改 ›」和「取消」'), ['「X」记为写对 · 修改 ›', '取消']);
  const covered = new Set([...Object.keys(source.entries), ...source.noCopy]);
  for (const r of rows) assert.ok(covered.has(r.id), r.id + ' accounted for');
});

test('copy: normalization unifies placeholders and turns <br> into lines', () => {
  assert.equal(normalizeRaw('{M} 月 {D} 日 · {时段}'), '{date} · {period}');
  assert.equal(normalizeRaw('下次练习 · 大约 {10 月 3 日} 再练到'), '下次练习 · 大约 {date} 再练到');
  assert.equal(normalizeRaw('「X」记为写对 · 修改 ›'), '「{char}」记为写对 · 修改 ›');
  assert.equal(normalizeRaw('回到「{字}」'), '回到「{char}」');
  assert.equal(normalizeRaw('还有 N 个字 ›'), '还有 {n} 个字 ›');
  assert.equal(normalizeRaw('还有 {N} 个字没写，…判断过的 {M} 个字'), '还有 {n} 个字没写，…判断过的 {m} 个字');
  assert.equal(normalizeRaw('M 月 D 日 · 你当时的笔迹'), '{date} · 你当时的笔迹');
  assert.equal(normalizeRaw('接着想 / 看答案', 1), '看答案');
  assert.deepEqual(normalizeRaw('一行<br>两行'), ['一行', '两行']);
  assert.throws(() => normalizeRaw('a / b', 2), /out of range/);
});

test('copy: t() fills placeholders, returns arrays for multi-line copy, and rejects unknown keys', () => {
  assert.equal(t('R-W05.hintRemaining', { n: 2 }), '提示，还有 2 次', 'D49：读屏名称；可见文字是 R-W05.hintLabel');
  assert.equal(t('R-W05.hintLabel'), '提示');
  assert.equal(t('R-W10.lineRecordedCorrect', { char: '静' }), '「静」记为写对 · 修改 ›');
  assert.deepEqual(t('R-L06.confirmBody'), ['以后的新字从这个字库里来。', '已有的记录、自选的字和写错过的字都不变。']);
  assert.equal(format('{n} / {total}', { n: 3 }), '3 / {total}', 'missing values stay visible');
  assert.throws(() => t('R-X99.nope'), /unknown copy key/);
  assert.equal(has('R-W03.titleRecall'), true);
  assert.ok(Object.isFrozen(COPY));
});

test('copy: decided multi-version cells use the 03 transitional choice', () => {
  assert.equal(has('R-W07.confirmBody'), false, 'P40 / D51 ⑧: the 看答案 confirm dialog is gone');
  assert.equal(has('R-W06.hintExplain'), false, 'P41 / D51 ⑧: the 「浅红色是提示」 legend sentence is gone');
  assert.equal(t('R-W07.firstExplain'), '以后点「看答案」会直接显示。', 'P212: one line the first time 看答案 is used');
  assert.equal(t('R-R02.sheetNoInk'), '这次没写', 'P15');
  assert.equal(t('R-Q04.rowCustomCount', { n: 3 }), '自选的字 · 记录了 3 次', 'P43');
  assert.equal(t('R-B01.clearUndoL1'), '记录已清空', 'P44');
  assert.equal(has('R-Q01.titleAdd'), false, 'P42: no add mode title');
});

test('copy: library names match the four-library governance labels (M0-2 contract)', () => {
  const names = ['core3500', 'adv3000', 'rare', 'curriculum2500'].map((id) => t('R-L06.lib.' + id + '.name'));
  assert.deepEqual(names, ['规范常用字', '规范次常用字', '规范专门用字', '小学初中常用字']);
  for (const v of Object.values(SCREENS.library)) {
    for (const line of Array.isArray(v) ? v : [v]) assert.equal(line.includes('义教基础字'), false);
  }
});

test('copy: a drifted value, a stray key and a missing key are all reported', () => {
  const screens = cloneScreens();
  screens.write['R-W05.hintUsedUp'] = '提示用完了';
  screens.home['R-H99.extra'] = '多出来的';
  delete screens.result['R-R01.titleZero'];
  const { errors } = checkCopy(source, screens);
  assert.ok(errors.some((e) => e.startsWith('R-W05.hintUsedUp') && e.includes('≠')));
  assert.ok(errors.some((e) => e.startsWith('R-H99.extra') && e.includes('not registered')));
  assert.ok(errors.some((e) => e.startsWith('R-R01.titleZero') && e.includes('missing')));
});

test('copy: a key in the wrong screen file is reported', () => {
  const screens = cloneScreens();
  screens.home['R-W03.titleRecall'] = screens.write['R-W03.titleRecall'];
  delete screens.write['R-W03.titleRecall'];
  const { errors } = checkCopy(source, screens);
  assert.ok(errors.some((e) => e.startsWith('R-W03.titleRecall') && e.includes('expected in copy/write.js')));
});

test('copy: banned legacy words, ASCII quotes and unlisted TODO values fail', () => {
  const screens = cloneScreens();
  const src = clone(source);
  src.extra['X-TEST'] = { screen: 'common', milestone: 'M0', slots: {
    a: { raw: null, text: '今天校准一下', origin: 'test', note: 'test' },
    b: { raw: null, text: '说"好"', origin: 'test', note: 'test' },
    c: { raw: null, text: 'TODO: 以后再写', origin: 'test', note: 'test' },
  } };
  screens.common = { ...screens.common, 'X-TEST.a': '今天校准一下', 'X-TEST.b': '说"好"', 'X-TEST.c': 'TODO: 以后再写' };
  const { errors, warnings } = checkCopy(src, screens);
  assert.ok(errors.some((e) => e.includes('banned word 「校准」')));
  assert.ok(errors.some((e) => e.includes('double quotes')));
  assert.ok(errors.some((e) => e.startsWith('X-TEST.c') && e.includes('allowlist')));
  src.todo.push('X-TEST.c');
  assert.ok(checkCopy(src, screens).warnings.some((w) => w.startsWith('X-TEST.c')));
  assert.equal(warnings.some((w) => w.startsWith('X-TEST.c')), false);
});

test('copy: source check catches unmapped 04 copy and unexplained overrides', () => {
  const src = clone(source);
  delete src.entries['R-W16'].slots.saved;
  assert.ok(checkSource(src, markdown).some((e) => e.includes('保存好了。') && e.includes('not mapped')));
  const src2 = clone(source);
  const slot = src2.entries['R-W05'].slots.hintRemaining;
  delete slot.decision;
  delete slot.note;
  assert.ok(checkSource(src2, markdown).some((e) => e.startsWith('R-W05.hintRemaining') && e.includes('without decision/note')));
  const src3 = clone(source);
  src3.entries['R-W05'].slots.hintUsedUp.raw = '提示用完了';
  assert.ok(checkSource(src3, markdown).some((e) => e.includes('not found in 04')));
  const src4 = clone(source);
  src4.entries['R-W01'].slots.progress.text = '{n} / {count}';
  src4.entries['R-W01'].slots.progress.note = 'x';
  assert.ok(checkSource(src4, markdown).some((e) => e.includes('{count} not registered')));
});

test('copy: --scope filters by milestone, id prefix and screen', () => {
  const slots = flattenSource(source);
  const m1 = slots.filter(scopeFilter('M1'));
  assert.ok(m1.some((s) => s.entryId === 'R-W05'));
  assert.equal(m1.some((s) => s.entryId === 'R-H01'), false);
  assert.ok(m1.some((s) => s.entryId === 'X-TABS'), 'M0 extras are always in');
  assert.equal(m1.some((s) => s.entryId === 'R-W15'), false, 'R-W15 is filled in M2-3');
  assert.ok(slots.filter(scopeFilter('R-H,R-W0')).every((s) => s.entryId.startsWith('R-H') || s.entryId.startsWith('R-W0')));
  assert.ok(slots.filter(scopeFilter('screen:judge')).every((s) => s.screen === 'judge'));
  assert.equal(slots.filter(scopeFilter('all')).length, slots.length);
});

test('copy: every screen file is a frozen plain table of strings / string arrays', () => {
  for (const [screen, table] of Object.entries(SCREENS)) {
    assert.ok(Object.isFrozen(table), screen);
    for (const [key, value] of Object.entries(table)) {
      assert.match(key, /^(R-[A-Z]+\d+|X-[A-Z]+)\.[A-Za-z0-9.]+$/, key);
      const ok = typeof value === 'string' || (Array.isArray(value) && value.every((v) => typeof v === 'string'));
      assert.ok(ok, key);
    }
  }
});
