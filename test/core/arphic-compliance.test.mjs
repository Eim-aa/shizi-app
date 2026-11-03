// 卡 C1（D50 ②，合规说明 §1.6.6 A1–A6 与 §1.16）：Arphic 数据补救与遗漏署名。
//   A1 APL 原文随包（licenses/ARPHICPL.TXT 与 sources 原件逐字相同，并在壳清单里）；
//   A2 363 个 AnimCJK 衍生文件首键 "_notice" 写明怎么改、什么时候改，去掉它就是清单里验收的原字节；core-strokes.js 头注释写明来源；
//   A3 data/LICENSE.md 逐文件写明许可，根 LICENSE 写明 data/ 例外；A4 写明公开获取地点；
//   A6 关于页「开源资料 · 致谢」的数据条目面向用户：不出现 audit/ 路径、清单文件名、「release gates」之类内部措辞；补 AnimCJK、jieba、pypinyin、hanziDB、wordfreq。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './helpers.mjs';
import { CREDITS, LICENSE_TEXTS } from '../../src/config/credits.js';

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const manifestLines = () => read('scripts/app-bundle-manifest.txt').split('\n'); // D84：随 App 分发的清单

test('A1: the unmodified Arphic Public License ships as licenses/ARPHICPL.TXT (and the other license texts the notices cite)', () => {
  assert.equal(read('licenses/ARPHICPL.TXT'), read('sources/LICENSE-ARPHIC-PUBLIC.txt'));
  assert.equal(read('licenses/LGPL-3.0.txt'), read('sources/LICENSE-LGPL-3.0.txt'));
  assert.equal(read('licenses/Apache-2.0.txt'), read('sources/LICENSE-APACHE-2.0.txt'));
  assert.equal(read('licenses/hanzi-writer-LICENSE.txt'), read('sources/LICENSE-MIT-HANZI-WRITER.txt'));
  assert.equal(sha(fs.readFileSync(path.join(ROOT, 'licenses/GPL-3.0.txt'))), '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903', 'canonical GPL-3.0 text (LGPL-3.0 incorporates it)');
  const lines = manifestLines();
  for (const f of ['licenses/ARPHICPL.TXT', 'licenses/LGPL-3.0.txt', 'licenses/GPL-3.0.txt', 'licenses/Apache-2.0.txt', 'licenses/jieba-LICENSE.txt', 'licenses/pypinyin-LICENSE.txt', 'data/LICENSE.md']) {
    assert.ok(lines.includes(f), `${f} is in the app bundle manifest`);
  }
  assert.ok(CREDITS.find(c => c.name === 'Hanzi Writer Data').licenseFiles.includes('licenses/ARPHICPL.TXT'));
  assert.equal(LICENSE_TEXTS['licenses/ARPHICPL.TXT'], read('licenses/ARPHICPL.TXT').replace(/\s+$/, '') + '\n');
});

test('A2: every AnimCJK-derived file states how and when it was changed; stripping the notice restores the accepted bytes', () => {
  const notices = JSON.parse(read('audit/compliance-2026-10/arphic-modification-notices.json'));
  const manifest = JSON.parse(read('audit/vector-data-460-manifest.json'));
  const animcjk = manifest.records.filter(r => r.route === 'animcjk_363');
  assert.equal(notices.records.length, 363);
  const byChar = new Map(notices.records.map(r => [r.character, r]));
  for (const r of animcjk) {
    const row = byChar.get(r.character);
    const bytes = fs.readFileSync(path.join(ROOT, r.data_path));
    const json = JSON.parse(bytes.toString('utf8'));
    assert.equal(Object.keys(json)[0], '_notice', `${r.character}: notice is the first key`);
    assert.equal(json._notice, row.notice);
    assert.match(json._notice, /Modified by the Shizi project: converted to Hanzi Writer JSON on 2026-07-29/);
    assert.match(json._notice, /Arphic Public License/);
    const prefix = Buffer.from(`{"_notice":${JSON.stringify(row.notice)},`, 'utf8');
    const original = Buffer.concat([Buffer.from('{'), bytes.subarray(prefix.length)]);
    assert.equal(sha(original), r.data_sha256, `${r.character}: original accepted bytes`);
  }
  assert.match(byChar.get('豨').notice, /exchanged stroke-order medians 5 and 7/);
  assert.match(byChar.get('镵').notice, /stroke 13 from 1-2-3 to 2-1-3/);
  // 未修改的基础数据没有 _notice
  assert.ok(!('_notice' in JSON.parse(read('data/一.json'))));
  assert.match(read('core-strokes.js').split('\n').slice(0, 5).join('\n'), /hanzi-writer-data 2\.0\.1，Arphic Public License，未修改/);
});

test('A3 / A4: data/LICENSE.md lists the license of every data file and the public place to get them; the root LICENSE carves data/ out', () => {
  const md = read('data/LICENSE.md');
  for (const s of ['Arphic Public License', 'licenses/ARPHICPL.TXT', 'AnimCJK', '"_notice"', 'data/𬇕.json', 'SIL Open Font License 1.1',
    'data/etymology.json', 'Apache License 2.0', 'GNU LGPL version 3', 'https://github.com/Eim-aa/shizi-open', 'tag']) {
    assert.ok(md.includes(s), s);
  }
  const license = read('LICENSE');
  assert.match(license, /All rights reserved/);
  assert.match(license, /Exception for data\//);
  assert.match(license, /data\/LICENSE\.md/);
});

test('A6 + §1.16: the in-app credits for data are written for users and name every source', () => {
  const names = CREDITS.map(c => c.name);
  for (const n of ['Hanzi Writer Data', 'AnimCJK', 'Make Me a Hanzi dictionary metadata', 'jieba dictionary', 'pypinyin', 'hanziDB', 'wordfreq']) {
    assert.ok(names.includes(n), n);
  }
  for (const c of CREDITS.filter(x => x.kind === 'data')) {
    assert.doesNotMatch(c.notice, /audit\/|LEGAL_RELEASE_CHECKLIST|release gate|outstanding/i, `${c.name}: no repository-internal wording`);
  }
  const hwd = CREDITS.find(c => c.name === 'Hanzi Writer Data').notice;
  assert.match(hwd, /Arphic Technology/);
  assert.match(hwd, /https:\/\/github\.com\/Eim-aa\/shizi-open/);
  assert.doesNotMatch(hwd, /Eim-aa\/shizi-app/);
  assert.match(CREDITS.find(c => c.name === 'AnimCJK').notice, /ec5e17cca76c87587790bcbce5ea0b4d4fb753d6/);
  assert.match(CREDITS.find(c => c.name === 'wordfreq').notice, /CC BY-SA 4\.0/);
  assert.match(CREDITS.find(c => c.name === 'LXGW WenKai GB').notice, /𬇕/, 'the LXGW-derived stroke data is attributed under OFL');
});
