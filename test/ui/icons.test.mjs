// 第三轮 C3-R（T2-20 / T2-21 / V3-08 / T3-05）：统一图标与线宽门禁。
//   · 图标都从 components/icons.js 取：线宽 1.5、圆端、线形、aria-hidden；
//   · 全仓 stroke-width 只许 1.5（逐条登记的例外除外：写字页十字参考线 0.75 是格子的第二档线；写字页的撤销 / 清空图标由写字页那张卡改，合并后例外会过期、
//     过期也报错，到时删掉登记）；
//   · 目标格线宽 = 格框线宽 = 1pt（tokens --target-w、tokens.json line.targetCellFrame）；
//   · 全仓没有 text-decoration:underline（文字按钮统一无下划线，设计说明第 21 条）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_STROKE, Icons } from '../../src/ui/components/icons.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (/\.(js|css|html)$/.test(name)) out.push(full);
  }
  return out;
}

const srcFiles = walkFiles(join(ROOT, 'src')).filter(f => !f.includes(`${join(ROOT, 'src')}/data/`));
const rel = f => relative(ROOT, f);

test('icons.js：每个图标 1.5 线宽、圆端圆角、线形、对读屏隐藏', () => {
  assert.equal(ICON_STROKE, 1.5);
  for (const [name, make] of Object.entries(Icons)) {
    const node = make();
    assert.equal(node.type, 'svg', name);
    assert.equal(node.props['stroke-width'], 1.5, `${name}: stroke-width`);
    assert.equal(node.props['stroke-linecap'], 'round', `${name}: round caps`);
    assert.equal(node.props['stroke-linejoin'], 'round', `${name}: round joins`);
    assert.equal(node.props.fill, 'none', `${name}: line icon`);
    assert.equal(node.props['aria-hidden'], 'true', `${name}: hidden from AT`);
  }
  assert.equal(Icons.close({ size: 18 }).props.width, 18);
  assert.equal(Icons.search({ cls: 'x', size: 0 }).props.width, undefined, 'size 0 leaves the size to CSS');
  assert.equal(Icons.check({ color: 'var(--paper)' }).props.stroke, 'var(--paper)');
});

// 例外登记：文件 → 允许出现的非 1.5 stroke-width 字面量（带理由）。登记了但文件里已经没有时报「过期」。
const STROKE_EXCEPTIONS = {
  'src/ui/canvas/ink-canvas.js': { values: ['0.75'], why: '书写格十字参考线是格子的第二档线（0.75 虚线，T2-21），不是图标' },
};

test('全仓图标线宽只有 1.5（stroke-width 属性）', () => {
  const found = new Map();
  const bad = [];
  for (const file of srcFiles) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/stroke-width\s*[=:]\s*["']?\s*([0-9.]+)/g)) {
      const value = m[1];
      if (value === '1.5') continue;
      const ex = STROKE_EXCEPTIONS[rel(file)];
      if (ex && ex.values.includes(value)) {
        found.set(rel(file), true);
        continue;
      }
      bad.push(`${rel(file)}: stroke-width ${value}`);
    }
  }
  assert.deepEqual(bad, [], 'icon stroke widths other than 1.5');
  for (const file of Object.keys(STROKE_EXCEPTIONS)) assert.ok(found.get(file), `stale stroke-width exception: ${file} no longer has the value (remove it from STROKE_EXCEPTIONS)`);
});

test('全仓没有 text-decoration:underline（文字按钮无下划线）', () => {
  const files = [...srcFiles, join(ROOT, 'index.html')];
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (/text-decoration(-line)?\s*:\s*[^;}]*underline/.test(text) || /text-underline-offset/.test(text)) hits.push(rel(file));
  }
  assert.deepEqual(hits, []);
});

test('目标格线宽 = 格框线宽 = 1pt（T2-21）：tokens.css 与 tokens.json', () => {
  const css = readFileSync(join(ROOT, 'src/config/tokens.css'), 'utf8');
  const tokens = JSON.parse(readFileSync(join(ROOT, 'docs/design/design-system-v1/tokens.json'), 'utf8'));
  assert.equal(tokens.line.targetCellFrame, tokens.line.frame, 'tokens.json');
  assert.equal(tokens.line.targetCellFrame, 1);
  const target = /--target-w:\s*([0-9.]+)px/.exec(css);
  const frame = /--frame-w:\s*([0-9.]+)px/.exec(css);
  assert.ok(target && frame);
  assert.equal(target[1], frame[1], 'one frame width, 1px');
  assert.equal(target[1], '1');
});
