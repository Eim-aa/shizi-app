// R3-K1（ADA A3-03，P243）：AX 档写字页辅助字分层封顶。样式里只能写字阶上的字面值（令牌门禁），这里核对样式与 policy.writeGrid.axAux 一致，
// 并且每一档都比题面汉字小（题面格 52 × min(k, 1.6)，字面占格 80%）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as policy from '../../src/config/policy.js';

const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const AUX = policy.writeGrid.axAux;
const LH = { 17: 24, 22: 30, 28: 36 };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decl = n => `{font-size:calc(${n}px * 1);line-height:${LH[n]}px}`;

test('axAux tiers are steps of the type scale and stay below the prompt glyph (52 × 1.6 × 80% ≈ 66)', () => {
  const scale = [11, 13, 15, 17, 22, 28, 34];
  const glyph = 52 * policy.writeGrid.axPromptScaleMax * 0.8;
  for (const [k, v] of Object.entries(AUX)) {
    assert.equal(v.length, 2, `${k}: [AX1–AX2, AX3–AX5]`);
    for (const n of v) {
      assert.ok(scale.includes(n), `${k}: ${n} is on the type scale`);
      assert.ok(n < glyph / 2, `${k}: ${n} < half of the prompt glyph (${glyph.toFixed(0)})`);
    }
    assert.ok(v[1] >= v[0], `${k}: the upper tier is not smaller`);
  }
});

test('write/index.js: note / counter / title / paper text use the AX1–AX2 value under :root[data-ax] and the AX3–AX5 value under data-ax 3 / 4 / 5', () => {
  const src = read('src/ui/screens/write/index.js');
  assert.match(src, new RegExp(esc(`:root[data-ax] \${W} .sz-write__below *,:root[data-ax] \${W} .sz-write__progress${decl(AUX.note[0])}`)));
  assert.equal(AUX.progress[0], AUX.note[0], 'counter and note share the AX1–AX2 rule');
  assert.match(src, new RegExp(esc(`\${AX_HI(\`\${W} .sz-write__below *\`)},\${AX_HI(\`\${W} .sz-write__progress\`)}${decl(AUX.note[1])}`)));
  assert.equal(AUX.progress[1], AUX.note[1]);
  assert.match(src, new RegExp(esc(`:root[data-ax] \${W} .sz-paper__back${decl(AUX.paper[0])}`)));
  assert.match(src, new RegExp(esc(`\${AX_HI(\`\${W} .sz-paper__back\`)}${decl(AUX.paper[1])}`)));
  assert.match(src, new RegExp(esc(`font-size:calc(${AUX.title[0]}px * 1);line-height:${LH[AUX.title[0]]}px}`)));
  assert.match(src, new RegExp(esc(`'[data-text-large]')}${decl(AUX.title[1])}`)));
  assert.match(src, /-webkit-line-clamp:2/, 'the title may wrap to two lines');
  assert.match(src, /const AX_HI = \(sel, extra = ''\) => \[3, 4, 5\]\.map/);
  assert.match(src, /const AX_NOTE_H_HI = 2 \* 30 \+ 8;/);
});

test('write/prompt.js: pinyin AX1–AX2 / AX3–AX5 and the room above the prompt cell follows the pinyin line height', () => {
  const src = read('src/ui/screens/write/prompt.js');
  assert.match(src, new RegExp(esc(`:root[data-ax] .sz-prompt__py${decl(AUX.pinyin[0])}`)));
  assert.match(src, new RegExp(esc(`:root[data-ax] .sz-prompt__wordwrap{padding-top:${LH[AUX.pinyin[0]] + 4}px}`)));
  assert.match(src, new RegExp(esc(`.sz-prompt__py\`).join(',')}${decl(AUX.pinyin[1])}`)));
  assert.match(src, new RegExp(esc(`.sz-prompt__wordwrap\`).join(',')}{padding-top:${LH[AUX.pinyin[1]] + 4}px}`)));
});
