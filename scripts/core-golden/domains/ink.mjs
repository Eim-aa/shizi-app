// 金标准 · 墨（src/core/ink-math.js；B4.3）：笔锋管线（buildStroke）、抽点、Ink v3 / v4 编码、v2 / v3 / v4 解码、原始笔画行、V8 的 Math.hypot / Math.exp 逐位复刻。
// 随机差分生成器的固定种子取样 + ink-v4-fixture.json（B2.3 的回放一致性夹具，原生 XCTest 与 node 共用）里每条墨迹的解码。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedCases } from '../lib/b43-golden.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function hand() {
  const R = [];
  const op = (name, args) => R.push({ op: name, args });
  for (const x of [0, 1, -1, 0.5, -0.5, -0.0285714285714, -1 / 35, -4 / 35, -16.7 / 35, -33 / 35, 2.5, 10, -10, 100, 709.78, -745.13, 1e-10, 1e-300, 0.6931471805599453, -0.6931471805599453, 1.0000000000000002, 0.9999999999999999]) op('jsmath.exp', { x });
  for (const [a, b] of [[0, 0], [3, 4], [1e-300, 1e-300], [1e300, 1e300], [0.1, 0.2], [345, 345], [-2.5, 1.5], [1, 1], [5, 12]]) op('jsmath.hypot', { a, b });
  for (const ms of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 384, 512, 768, 1024, 1536, 2048, 5000, -3, 0.4, 2.5]) op('ink.quantizeDt', { ms });
  for (const str of ['', 'AA==', 'AAA=', 'A===', '=AAA', 'AAA', 'AB==', 'AAB=', 'AAAA', 'AAAAAAAA', '+/+/', 'Zm9vYg==', 'Zm9vYmE=', 'Zm9vYmFy']) {
    op('ink.isBase64', { str });
    op('ink.base64ToBytes', { str });
  }
  for (const bytes of [[], [0], [0, 1], [255, 255, 255], [102, 111, 111, 98, 97, 114], [1, 2, 3, 4, 5]]) op('ink.bytesToBase64', { bytes });
  for (const row of [[3, 0, 0, 0], [3, 3450, 3450, 5], [4, 10, 20, 0, 500, 40, 20, 8, 600], [3, -5, -1, 0], [3, 1, 2, 3, 4, 5, 6], [3, 0, 0, 0, 0, 0, 100000], [3, 1e15, 2, 3]]) {
    op('ink.rawRowToPacked', { row });
    op('ink.decodeRawStrokes', { rows: [row] });
  }
  // v4 回放夹具里的每条墨迹
  const file = path.join(ROOT, 'docs/engineering/v10/phase1/ink-model/ink-v4-fixture.json');
  if (fs.existsSync(file)) {
    const fx = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const c of fx.cases) {
      op('ink.isInk', { ink: c.ink });
      op('ink.inkRawRows', { ink: c.ink });
      op('ink.decodeInkRaw', { ink: c.ink });
      op('ink.decodeInk', { ink: c.ink });
    }
  }
  return R;
}

export default {
  id: 'ink',
  source: 'src/core/ink-math.js',
  build({ withTZ, opCases }) {
    return { groups: [withTZ('Asia/Shanghai', () => ({ tz: 'Asia/Shanghai', cases: opCases([...hand(), ...generatedCases('ink', { seed: 4305, perOp: 24 })]) }))] };
  },
};
