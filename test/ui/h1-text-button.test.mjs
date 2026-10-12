// H1-1（D51 ⑥、T2-02）：文字按钮一种规格 + 「›」一条规则（单测；渲染后的真实计算样式见 e2e 81-h1-text-buttons）。
//   规格：黑体 15、--ink2、无下划线、按下变 --ink1（Button.js .sz-btn--text）。
//   「›」规则：标签是「去处的名字」才带「›」；标签是动作（撤销、取消、练这些字、保存图片……）不带；「→」不再出现在运行时文案里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY } from '../../src/config/copy/index.js';

const buttonSrc = readFileSync(new URL('../../src/ui/components/Button.js', import.meta.url), 'utf8');

function textRule() {
  const m = /\n\.sz-btn--text\{([\s\S]*?)\}\n/.exec(buttonSrc);
  assert.ok(m, '.sz-btn--text rule exists');
  return m[1];
}

test('.sz-btn--text: 黑体 15、ink2、无下划线', () => {
  const rule = textRule();
  assert.match(rule, /font-size:\$\{T\.fs15\}/);
  assert.match(rule, /color:\$\{T\.ink2\}/);
  assert.match(rule, /text-decoration:none/);
  assert.doesNotMatch(rule, /underline/);
  assert.match(buttonSrc, /\.sz-btn--text\[data-pressed\]\{color:\$\{T\.ink1\}/, 'pressed → ink1');
});

test('Button.js 之外没有给文字按钮加回下划线 / 改字号的覆盖（home / library / detail / mine / 共用组件）', () => {
  const files = [
    '../../src/ui/screens/home/index.js',
    '../../src/ui/screens/library/index.js',
    '../../src/ui/screens/library/all.js',
    '../../src/ui/screens/library/list.js',
    '../../src/ui/screens/detail/actions.js',
    '../../src/ui/screens/mine/backup.js',
    '../../src/ui/screens/mine/index.js',
    '../../src/ui/components/UndoBar.js',
  ];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /text-decoration\s*:\s*underline/, `${f}: no underline`);
  }
  const home = readFileSync(new URL('../../src/ui/screens/home/index.js', import.meta.url), 'utf8');
  for (const cls of ['sz-home__other', 'sz-home__side']) {
    const m = new RegExp(`\\.${cls}\\.sz-btn\\{([^\\n]*)\\}\\n`).exec(home);
    assert.ok(m, `${cls} rule exists`);
    assert.doesNotMatch(m[1], /font-size|color:/, `${cls} 不覆盖字号与颜色`);
  }
});

// 去处的名字（标签是名词性的去处）：允许行尾「›」。写字页的「修改 ›」是动作带了「›」，属于另一张卡（写字页）的待修项，先列例外。
const DESTINATION = new Set([
  'R-H11.backHome', 'R-H11.noCharsLink', 'R-L02.more', 'R-L06.entry', 'X-LIST.restShow', 'X-ALL.closedCount',
  'R-M05.sheetAll', 'X-LIBHOME.viewThese', 'X-ALL.viewThese', 'X-WORK.adjustImage', 'R-S02.link', 'R-AB01.privacyRow', 'R-AB01.openSourceRow',
]);
const KNOWN_EXCEPTIONS = new Set(['R-W10.lineRecordedCorrect', 'R-W10.lineRecordedWrong', 'R-W10.lineChangedCorrect', 'R-W10.lineChangedWrong']);

test('「›」只跟在去处名后；动作标签不带；运行时文案里没有「→」', () => {
  const withChevron = Object.entries(COPY).filter(([, v]) => typeof v === 'string' && v.length > 1 && /›\s*$/.test(v));
  for (const [key] of withChevron) {
    assert.ok(DESTINATION.has(key) || KNOWN_EXCEPTIONS.has(key), `${key} 带「›」但不在去处名清单里：动作标签不带「›」`);
  }
  for (const key of ['R-A02.practiceThese', 'X-LIBHOME.practiceThese', 'R-M01.saveImage', 'R-P03.todayImage', 'X-HOME.pick', 'X-HOME.capitalDefer']) {
    assert.ok(COPY[key] !== undefined, `${key} exists`);
    assert.doesNotMatch(COPY[key], /[›→]/, `${key} 是动作，不带箭头`);
  }
  for (const [key, v] of Object.entries(COPY)) {
    if (typeof v === 'string') assert.ok(!v.includes('→'), `${key} 不用「→」`);
  }
});
