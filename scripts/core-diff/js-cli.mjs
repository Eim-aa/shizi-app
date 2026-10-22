#!/usr/bin/env node
// JS 参考引擎的 JSON 行协议外壳（B4.0）：与 Swift 的 shizi-core-cli 同一协议，供差分驱动自检（JS ↔ JS 经子进程）。
//   node scripts/core-diff/js-cli.mjs [--fault <名>]     时区取 TZ 环境变量
import { onLines } from './lib/lines.mjs';
import { createJsEngine } from './lib/js-engine.mjs';

const argv = process.argv.slice(2);
const fi = argv.indexOf('--fault');
const engine = createJsEngine({ fault: fi >= 0 ? argv[fi + 1] : null });
onLines(process.stdin, (line) => {
  if (line === '') return;
  process.stdout.write(engine.handleLine(line) + '\n');
});
