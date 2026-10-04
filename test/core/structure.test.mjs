// R2-A1（A2-09 / D45；03 P232）：参考字形的结构（左右 / 上下）与部件数——部件分组（deck-data.js GROUPS）+ 笔顺中线（data/<字>.json）的几何推导。
// 校准测试读 sources/make-me-a-hanzi-dict.txt 的 IDS 当对照（只在测试里读，不随 App 发布）：2 部件字里断言的结构必须与 IDS 一致（精度 ≥ 99.5%），
// 且不能把包围 / 半包围 / 镶嵌的字断言成左右或上下。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describeStructure, inferStructure, validGroups } from '../../src/core/structure.js';
import { refCardLabel, structureText } from '../../src/ui/screens/write/ref-label.js';

const ROOT = new URL('../../', import.meta.url);
const GROUPS = JSON.parse(/const GROUPS=(\{.*?\});?\n/s.exec(readFileSync(new URL('deck-data.js', ROOT), 'utf8'))[1]);
const dataOf = ch => JSON.parse(readFileSync(new URL(`data/${ch}.json`, ROOT), 'utf8'));
const strokeData = ch => ({ status: 'ready', data: dataOf(ch) });

test('validGroups：每组正整数、总和 = 笔画数', () => {
  assert.equal(validGroups([5, 3], 8), true);
  assert.equal(validGroups([5, 3], 9), false);
  assert.equal(validGroups([], 0), false);
  assert.equal(validGroups([0, 8], 8), false);
  assert.equal(validGroups(null, 8), false);
});

test('左右结构：的（白 + 勺）、根（木 + 艮）、和（禾 + 口）', () => {
  for (const ch of ['的', '根', '和']) {
    assert.equal(inferStructure(GROUPS[ch], dataOf(ch).medians), 'lr', ch);
  }
});

test('上下结构：思（田 + 心）、花（艹 + 化）、男（田 + 力）、昌（日 + 日）', () => {
  for (const ch of ['思', '花', '男', '昌']) {
    assert.equal(inferStructure(GROUPS[ch], dataOf(ch).medians), 'tb', ch);
  }
});

test('包围 / 半包围 / 镶嵌与单部件不断言结构：尴（⿺）、同（⿵）、国（⿴）、大', () => {
  for (const ch of ['尴', '同', '国']) {
    if (GROUPS[ch].length !== 2) continue;
    assert.equal(inferStructure(GROUPS[ch], dataOf(ch).medians), null, ch);
  }
  assert.equal(inferStructure(GROUPS['大'], dataOf('大').medians), null);
  assert.equal(GROUPS['人'].length, 1);
});

test('describeStructure：断言了结构就不重复部件数；没结构时 2–4 个部件报部件数；1 个与 5 个不说', () => {
  const lr = describeStructure({ groups: GROUPS['的'], medians: dataOf('的').medians });
  assert.deepEqual(lr, { structure: 'lr', parts: null });
  const many = Object.keys(GROUPS).find(ch => GROUPS[ch].length === 3 && existsSync(new URL(`data/${ch}.json`, ROOT)));
  assert.deepEqual(describeStructure({ groups: GROUPS[many], medians: dataOf(many).medians }), { structure: null, parts: 3 }, many);
  const five = Object.keys(GROUPS).find(ch => GROUPS[ch].length === 5 && existsSync(new URL(`data/${ch}.json`, ROOT)));
  assert.deepEqual(describeStructure({ groups: GROUPS[five], medians: dataOf(five).medians }), { structure: null, parts: null }, five);
  assert.deepEqual(describeStructure({ groups: [8], medians: dataOf('的').medians }), { structure: null, parts: null }, '1 组');
  assert.deepEqual(describeStructure({ groups: [5, 4], medians: dataOf('的').medians }), { structure: null, parts: null }, '分组与笔数对不上');
  assert.deepEqual(describeStructure({}), { structure: null, parts: null });
});

test('参考字形读屏名称：字，拼音，n 画，结构 / 部件数；没数据的部分不说（判断页与看答案页共用 ref-label.js）', () => {
  const g = ch => GROUPS[ch]; // 单测没有 deck-data.js 的全局 GROUPS：显式传
  assert.equal(refCardLabel({ char: '的', py: 'dì', strokeData: strokeData('的'), groups: g('的') }), '参考字形：的，dì，8 画，左右结构');
  assert.equal(refCardLabel({ char: '思', py: 'sī', strokeData: strokeData('思'), groups: g('思') }), '参考字形：思，sī，9 画，上下结构');
  const many = Object.keys(GROUPS).find(ch => GROUPS[ch].length === 3 && existsSync(new URL(`data/${ch}.json`, ROOT)));
  assert.match(refCardLabel({ char: many, py: 'x', strokeData: strokeData(many), groups: g(many) }), /^参考字形：.，x，\d+ 画，3 个部件$/);
  assert.equal(refCardLabel({ char: '的', py: 'dì', strokeData: { status: 'loading', data: null }, groups: g('的') }), '参考字形：的，dì', '数据没到：不说笔画与结构');
  assert.equal(refCardLabel({ char: '的', py: '', strokeData: strokeData('的'), groups: g('的') }), '参考字形：的', '没有拼音：只读字');
  assert.equal(refCardLabel({ char: '人', py: 'rén', strokeData: strokeData('人'), groups: g('人') }), '参考字形：人，rén，2 画', '1 个部件：不说');
  assert.equal(refCardLabel({ char: '大', py: 'dà', strokeData: strokeData('大'), groups: g('大') }), '参考字形：大，dà，3 画，2 个部件', '镶嵌的 2 部件：几何推不出结构，只报部件数');
  assert.equal(structureText({ char: '的', data: dataOf('的'), groups: null }), '', '没有分组数据：不说');
});

test('校准：2 部件字里断言的结构与 MMAH 的 IDS 一致（只读测试，不随 App 发布）', { skip: !existsSync(new URL('sources/make-me-a-hanzi-dict.txt', ROOT)) }, () => {
  const ids = new Map(readFileSync(new URL('sources/make-me-a-hanzi-dict.txt', ROOT), 'utf8').split('\n').filter(Boolean)
    .map(line => JSON.parse(line)).map(r => [r.character, (r.decomposition || '')[0]]));
  const truth = { '⿰': 'lr', '⿱': 'tb' };
  let claimed = 0;
  let right = 0;
  let enclosureClaimed = 0;
  let twoPart = 0;
  for (const [ch, groups] of Object.entries(GROUPS)) {
    if (groups.length !== 2 || !ids.has(ch) || !existsSync(new URL(`data/${ch}.json`, ROOT))) continue;
    const d = dataOf(ch);
    if (!validGroups(groups, d.medians.length)) continue;
    twoPart += 1;
    const got = inferStructure(groups, d.medians);
    if (!got) continue;
    claimed += 1;
    if (truth[ids.get(ch)] === got) right += 1;
    else if ('⿴⿵⿶⿷⿸⿹⿺'.includes(ids.get(ch))) enclosureClaimed += 1;
  }
  assert.ok(twoPart > 2000, `2-part chars: ${twoPart}`);
  assert.ok(claimed > 1200, `claims: ${claimed}`);
  assert.ok(right / claimed >= 0.995, `precision ${right}/${claimed}`);
  assert.ok(enclosureClaimed <= 3, `enclosing structures claimed as lr/tb: ${enclosureClaimed}`);
});
