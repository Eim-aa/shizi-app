// R2-A1（A2-03；03 P233）：次级页 AX 档防叠——月历改成每天一行的列表、周条改成一句话、字帖角标在 AX 档不画（日期进读屏名称）。
// 渲染后的位置 / 不相交断言见 e2e 91-a1-secondary-ax；这里是模型与源码约定。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY } from '../../src/config/copy/index.js';
import { recordsModel } from '../../src/ui/screens/mine/model.js';

const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const TODAY = '2026-10-05';

let serial = 0;
function rec(c, day) {
  serial += 1;
  return { id: `r${serial}`, cardKey: `base:${c}`, char: c, sessionId: 's1', kind: 'judged', judgment: 'correct',
    at: new Date(`${day}T08:00:00`).getTime() + serial, localDay: day, help: { hints: 0, answerSeen: false, traced: false } };
}

test('recordsModel.dayList：有记录的每一天一项（升序）、n = 那天写的字数、标出今天', () => {
  serial = 0;
  const records = [rec('一', '2026-10-01'), rec('二', '2026-10-01'), rec('三', '2026-10-03'), rec('四', '2026-10-05'), rec('五', '2026-10-05'), rec('六', '2026-10-05'), rec('七', '2026-09-20')];
  const months = {};
  for (const r of records) (months[r.localDay.slice(0, 7)] || (months[r.localDay.slice(0, 7)] = [])).push(r);
  const state = { records: months, sessions: { A: null, B: null, lastEnded: {} } };
  const m = recordsModel(state, TODAY, { month: '2026-10' });
  assert.deepEqual(m.dayList, [
    { day: '2026-10-01', n: 2, today: false },
    { day: '2026-10-03', n: 1, today: false },
    { day: '2026-10-05', n: 3, today: true },
  ]);
  assert.equal(m.dayList.length, m.recordDays, '行数 = 有记录的天数');
  const sep = recordsModel(state, TODAY, { month: '2026-09' });
  assert.deepEqual(sep.dayList, [{ day: '2026-09-20', n: 1, today: false }]);
  assert.deepEqual(recordsModel({ records: {}, sessions: { A: null, B: null, lastEnded: {} } }, TODAY, {}).dayList, []);
});

test('文案：每天一行「10月3日 · 记了 5 个字」、周条一句话「写了 n 天」', () => {
  assert.equal(COPY['X-MINE.axDayRow'], '{date} · 记了 {n} 个字');
  assert.equal(COPY['X-MINE.axDayRowPaper'], '{date} · 有记录');
  assert.equal(COPY['X-MINE.weekSummary'], '写了 {n} 天');
  assert.equal(COPY['X-MINE.weekSummaryNone'], '还没有记录');
});

test('练习记录页：AX 档渲染列表（CalendarList，data-mode=list，行紧跟展开的那天），标准档仍是 7 列月历', () => {
  const src = read('src/ui/screens/mine/records.js');
  assert.match(src, /import \{ useAxLevel \} from '\.\.\/\.\.\/components\/ax\.js'/);
  assert.match(src, /ax > 0\s*\n?\s*\? html`<\$\{CalendarList\}/);
  assert.match(src, /data-testid="records-calendar" data-mode="list"/);
  assert.match(src, /\$\{open \? html`<\$\{DayList\}/, '那天写的字紧跟在该行下面');
  assert.match(src, /<\$\{Calendar\} model=/, '标准档月历还在');
  assert.match(src, /:root\[data-ax\] \.sz-scell__tag\{display:none\}/, 'AX 档不画字帖格角标');
});

test('我的页：AX 档周条换成 mine-week-summary 一句话；标题与右侧链接放不下时上下排；菜单行的值换到标题下面', () => {
  const src = read('src/ui/screens/mine/index.js');
  assert.match(src, /ax > 0\s*\n?\s*\? html`<p class="sz-mine__weeksum" data-testid="mine-week-summary"/);
  assert.match(src, /:root\[data-ax\] \.sz-mine__bhead\{flex-wrap:wrap/);
  assert.match(src, /:root\[data-ax\] \.sz-mine__row\.sz-btn\{flex-wrap:wrap/);
});

test('月字帖页 / 单字详情：AX 档不画月字帖格角标、记录格两列且日期可折行（词内不折）', () => {
  assert.match(read('src/ui/components/work.js'), /:root\[data-ax\] \.sz-mcell__tag\{display:none\}/);
  const det = read('src/ui/screens/detail/records.js');
  assert.match(det, /:root\[data-ax\] \.sz-drec__grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(det, /:root\[data-ax\] \.sz-dcell__date,:root\[data-ax\] \.sz-dcell__cap\{white-space:normal;word-break:keep-all\}/);
});

test('字帖格读屏名称带日期（角标是 aria-hidden 的，AX 档不画也不丢信息）', () => {
  const src = read('src/ui/screens/mine/records.js');
  assert.match(src, /X-MINE\.cellLabel', \{ char: cell\.char, date: dayText\(cell\.day\) \}/);
  assert.match(src, /<span class="sz-scell__tag" aria-hidden="true">/);
});
