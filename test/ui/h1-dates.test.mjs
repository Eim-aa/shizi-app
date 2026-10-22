// H1-10（V2-08、T2-04；03 P224）：界面日期写法统一一种——「10月4日」「9月」「2026年10月」，月 / 日 / 年的单位字紧跟数字，不加空格；
// 日期后面接汉字（「的笔迹」「再练到」）也不留空格；记录格下是两行「10月4日 / 写对」；行内间隔号「·」不落在行首。
import test from 'node:test';
import assert from 'node:assert/strict';
import { COPY, t } from '../../src/config/copy/index.js';
import { cellCopy as cellCopyRaw } from '../../src/ui/screens/detail/records.js';
import { renderRefs } from '../../src/config/copy/index.js';

const cellCopy = record => renderRefs(cellCopyRaw(record));
import { listRowMetaParts } from '../../src/session/views/library-list.js';

test('运行时文案里没有「数字 / 占位符 + 空格 + 月 / 日 / 年」，也没有「月 / 日 / 年 + 空格 + 数字 / 占位符」', () => {
  const bad = Object.entries(COPY).filter(([, v]) => typeof v === 'string' && (/[}\d] (月|日|年)/.test(v) || /(月|日|年) [{\d]/.test(v)));
  assert.deepEqual(bad.map(([k, v]) => `${k}: ${v}`), []);
});

test('日期单位字后面不留空格再接汉字（「4 月 26 日 的笔迹」式）', () => {
  assert.equal(t('R-M06.inkDate', { date: '4月26日' }), '4月26日的笔迹');
  assert.equal(t('R-D02.nextReview', { date: '10月7日' }), '下次复习 · 大约 10月7日');
  const bad = Object.entries(COPY).filter(([, v]) => typeof v === 'string' && /\{(date|inkDate)\} [一-鿿]/.test(v));
  assert.deepEqual(bad.map(([k]) => k), [], '{date} 后面直接接汉字，不隔空格');
});

test('一种写法：首页日期 / 月标题 / 月字帖 / 年月', () => {
  assert.equal(t('R-H02.dateFormat', { month: 10, day: 4 }), '10月4日');
  assert.equal(t('R-H02.line', { date: t('R-H02.dateFormat', { month: 10, day: 4 }), period: '晚上' }), '10月4日 · 晚上');
  assert.equal(t('X-ALL.groupMonth', { month: 9 }), '9月');
  assert.equal(t('X-ALL.groupMonthYear', { year: 2025, month: 12 }), '2025年12月');
  assert.equal(t('R-A03.foundIn', { month: 9 }), '在 9月');
  assert.equal(t('R-I01.kindMonth', { month: 10 }), '10月字帖');
  assert.equal(t('R-P02.sheetTitle', { month: 10 }), '10月字帖');
  assert.equal(t('X-WORK.monthTitle', { month: 9 }), '9月字帖', '落款侧（work.js）本来就是这一种');
  assert.equal(t('X-MINE.monthHead', { month: 10 }), '10月');
  assert.equal(t('R-M06.monthDays', { month: 10, n: 2 }), '10月写了 2 天');
});

test('cellCopy：记录格下两行「日期 / 判断」，读屏名与放大标题「日期 · 判断」', () => {
  const r = { id: 'r1', cardKey: 'base:静', char: '静', kind: 'judged', judgment: 'wrong', localDay: '2026-09-08' };
  assert.deepEqual(cellCopy(r), { date: '9月8日', caption: '写错', title: '9月8日 · 写错' });
  assert.deepEqual(cellCopy({ ...r, judgment: 'correct' }), { date: '9月8日', caption: '写对', title: '9月8日 · 写对' });
  assert.equal(COPY['X-DETAIL.cellCaption'], undefined, '「8·4 写对」式的文案槽已删');
});

test('行内间隔号不落在行首：「A · B」拆成「A ·」「B」，间隔号随前一段', () => {
  assert.deepEqual(listRowMetaParts('9月8日写错 · 一共写错 3 次'), ['9月8日写错 ·', '一共写错 3 次']);
  assert.deepEqual(listRowMetaParts('最近一次 9月8日 · 记录了 2 次'), ['最近一次 9月8日 ·', '记录了 2 次']);
  assert.deepEqual(listRowMetaParts('只有一段'), ['只有一段']);
  for (const part of listRowMetaParts('甲 · 乙 · 丙')) assert.ok(!part.startsWith('·'), `${part} 不以间隔号起头`);
});
