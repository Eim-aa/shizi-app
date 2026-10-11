// R3-K1（ADA A3-02，P242）：中文折行。不再用 word-break:keep-all（WebKit 里中文整句不折、按钮文字溢出）；
// 按钮 / 菜单项的文字经 Intl.Segmenter 分词，每个词一个 nowrap 的 span，只在词与词之间折；正文与说明句用正常 CJK 折行 + line-break:strict。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { segmentWords } from '../../src/ui/components/Words.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

test('segmentWords: words stay whole, punctuation sticks to its neighbour (no line starts with 「，」 or ends with 「「」), spaces are break points', () => {
  assert.deepEqual(segmentWords('描好了，自己写'), ['描', '好了，', '自己', '写']);
  assert.deepEqual(segmentWords('先写一次这个字，才能做成图片。'), ['先', '写', '一次', '这个', '字，', '才能', '做成', '图片。']);
  assert.deepEqual(segmentWords('「根」记为写错 · 修改 ›'), ['「根」', '记', '为', '写错', ' ', '·', ' ', '修改', ' ', '›']);
  assert.deepEqual(segmentWords('再试一次'), ['再试一次']);
  assert.deepEqual(segmentWords(''), []);
  assert.equal(segmentWords('看答案').join(''), '看答案', 'concatenation is the original text');
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('no stylesheet in src uses word-break:keep-all any more (it stops Chinese sentences from wrapping in WebKit)', () => {
  const hits = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const code = readFileSync(file, 'utf8').split('\n').filter(line => !/^\s*(\/\/|\*)/.test(line)).join('\n');
    if (/word-break\s*:\s*keep-all/.test(code)) hits.push(file.slice(ROOT.length));
  }
  assert.deepEqual(hits, []);
});

test('buttons segment their string text into words; AX button / menu / detail rules use line-break:strict', () => {
  const button = read('src/ui/components/Button.js');
  assert.match(button, /typeof children === 'string' \? html`<\$\{Words\} text=\$\{children\} \/>` : children/);
  assert.match(read('src/ui/components/Words.js'), /\.sz-words__w\{white-space:nowrap\}/);
  assert.match(read('src/ui/components/Words.js'), /html`<span class="sz-words">/, 'one wrapper: words never become separate flex / grid items of an inline-flex button');
  assert.match(read('src/ui/components/ax.js'), /\.sz-btn--secondary\{min-height:var\(--btn-h\);height:auto;padding-top:6px;padding-bottom:6px;\n  white-space:normal;line-break:strict\}/);
  assert.match(read('src/ui/components/ax.js'), /\.sz-btn--text\{min-height:max\(44px, calc\(1\.3em \+ 12px\)\);white-space:normal;line-break:strict/, 'the write foot text row folds by word too (R4-F1)');
  assert.match(read('src/ui/screens/detail/records.js'), /:root\[data-ax\] \.sz-drec__first\{text-align:left;line-break:strict\}/);
});
