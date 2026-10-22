// 金标准 · 备份双向往返（B4.4；计划 §4.4「备份文件：双向」）。每个用例是一段 op 序列，在 JS 参考引擎上跑出每一步的回包：
//   1. 打开一个 store（localStorage 替身 / 原生替身），seed 一份状态，backup.export → JS 导出的备份文本（全文写进夹具）；
//   2. 换另一种后端打开一个空 store，backup.restore 这份文本 → 恢复后的整份状态 / 磁盘（回包校验和）；
//   3. 再导出一次、撤销、重启。
// Swift 的 BackupRoundTripTests 用 CoreEngine 逐步重放：
//   · JS → Swift：第 2 步 Swift 恢复 JS 导出的文件，回包（含 store 状态快照与磁盘）的校验和必须与 JS 相同；
//   · Swift → JS：第 1 步 Swift 导出的文本必须与 JS 导出的逐字节相同——JS 恢复它就是恢复自己导出的文件（第 2 步在 JS 上已跑过）。
//     verify:core-diff 另有 scripts/core-diff/backup-roundtrip.mjs 把 Swift 命令行导出的文件实际交给 JS 恢复再比状态。
// 另有 v1 旧备份（scripts/fixtures/legacy-v1/backup-300.json，300 字）恢复到两种后端。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsEngine } from '../../core-diff/lib/js-engine.mjs';
import { makeCtx, rng } from '../../core-diff/lib/gen.mjs';
import { storeState, STORE_T0 } from '../../core-diff/domains/store.mjs';
import { checksum } from '../../../src/platform/native-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const V1_FILE = 'scripts/fixtures/legacy-v1/backup-300.json';

/** 跑一段序列；'@export' = 上一次 backup.export 的回包，'@file' = v1 文件全文。 */
function run(engine, steps, fileText = null) {
  const out = [];
  let lastExport = null;
  for (const req of steps) {
    let real = req;
    if (req.args && req.args.input === '@file') real = { ...req, args: { ...req.args, input: fileText } };
    if (req.args && req.args.input === '@export') real = { ...req, args: { ...req.args, input: lastExport } };
    const res = engine.handleLine(JSON.stringify(real));
    const parsed = JSON.parse(res);
    const step = { req, resSum: checksum(res) };
    if (req.op === 'backup.export') {
      step.reply = parsed.reply;
      lastExport = parsed.reply;
    }
    if (req.op === 'backup.restore') step.result = parsed.reply;
    out.push(step);
  }
  return out;
}

export default {
  id: 'backup-roundtrip',
  source: 'src/core/backup.js、src/store/store.js（JS 参考引擎 scripts/core-diff/lib/js-ops-b44.mjs）',
  build({ withTZ }) {
    return withTZ('Asia/Shanghai', () => {
      const cases = [];
      let seed = 0;
      while (cases.length < 24 && seed < 400) {
        seed += 1;
        const s = storeState(makeCtx(rng(seed)));
        const probe = createJsEngine();
        probe.handle({ op: 'store.open', args: { backend: 'local', clock: STORE_T0 } });
        if (!probe.handle({ op: 'store.seed', args: { state: s } }).reply.ok) continue;
        const from = cases.length % 2 ? 'native' : 'local';
        const to = from === 'local' ? 'native' : 'local';
        const steps = [
          { op: 'store.open', args: { backend: from, clock: STORE_T0 } },
          { op: 'store.seed', args: { state: JSON.parse(JSON.stringify(s)) } },
          { op: 'backup.export', args: {} },
          { op: 'store.open', args: { backend: to, clock: STORE_T0 + 3600000 } },
          { op: 'backup.restore', args: { input: '@export' } },
          { op: 'backup.export', args: {} },
          { op: 'backup.undo', args: {} },
          { op: 'store.reboot', args: {} },
        ];
        cases.push({ label: `seed ${seed} ${from} -> ${to}`, steps: run(createJsEngine(), steps) });
      }
      const v1 = fs.readFileSync(path.join(ROOT, V1_FILE), 'utf8');
      for (const backend of ['local', 'native']) {
        const steps = [
          { op: 'store.open', args: { backend, clock: STORE_T0 } },
          { op: 'backup.restore', args: { input: '@file' } },
          { op: 'backup.export', args: {} },
          { op: 'store.reboot', args: {} },
        ];
        cases.push({ label: `v1 backup-300 -> ${backend}`, inputFile: V1_FILE, steps: run(createJsEngine(), steps, v1) });
      }
      return { cases };
    });
  },
};
