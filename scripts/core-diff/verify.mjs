#!/usr/bin/env node
// pnpm run verify:core-diff（B4.0）：ShiziCore 等价性门禁一条命令跑完。
//   1. swift build -c release（shizi-core-cli）
//   2. swift test（ShiziCoreTests：金标准 + 协议）
//   3. 配置 / 数据资源与 src/ 同步（scripts/build_core_config.mjs --check）、金标准夹具与 JS 代码同步（scripts/core-golden/golden.mjs --check）
//   4. 差分驱动自检（JS ↔ JS、埋错必抓 + 缩小、协议语料 JS ↔ Swift）
//   5. 随机差分 JS ↔ Swift：Asia/Shanghai 200 种子 × 300 步；America/New_York、Australia/Lord_Howe、America/Santiago 各 50 × 300
//   5b. B4.4：store 域单独加量（store / storage / budget / backup / migrate，含写失败 / 撞配额 / 中断注入）：Shanghai 200 × 300、New_York 50 × 300；
//       备份双向往返实跑（scripts/core-diff/backup-roundtrip.mjs：Swift 导出 → JS 恢复、JS 导出 → Swift 恢复，两种后端）
//   6. 调度模拟器 JS ↔ Swift（B4.2，schedule-sim --engine both；B4.4 起 --swift-store core：Swift 一侧开组等提交在 ShiziCore 的真 Store 上跑）：
//      20 个场景压到 30 天；--nightly 跑满天数
//   7. 转写清单与测试同步（不同步只警告：别的卡加测试不该卡住这里）
// 选项：--nightly（Shanghai 5000 种子、其余各 500；模拟器跑满天数）；--skip-swift-test；--no-build（用已编好的命令行）。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = path.join(ROOT, 'ios/ShiziCore');
const argv = process.argv.slice(2);
const nightly = argv.includes('--nightly');

const results = [];
function step(name, cmd, args, { env = {}, warnOnly = false } = {}) {
  process.stdout.write(`\n== ${name}\n`);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  const ok = r.status === 0;
  results.push({ name, ok, warnOnly, secs: ((Date.now() - t0) / 1000).toFixed(1), missing: r.error && r.error.code === 'ENOENT' });
  return ok;
}

if (!argv.includes('--no-build')) {
  if (!step('swift build -c release', 'swift', ['build', '-c', 'release', '--package-path', PKG])) finish();
}
if (!argv.includes('--skip-swift-test')) step('swift test', 'swift', ['test', '--package-path', PKG]);
step('配置与数据资源同步（build_core_config --check）', process.execPath, ['scripts/build_core_config.mjs', '--check']);
step('金标准同步', process.execPath, ['scripts/core-golden/golden.mjs', '--check']);
step('会话资源同步', process.execPath, ['scripts/core-golden/session-resources.mjs', '--check']);
step('会话契约夹具同步', process.execPath, ['scripts/core-golden/session-contract.mjs', '--check']);
step('会话分支覆盖', process.execPath, ['scripts/core-diff/session-shapes.mjs']);
step('会话随机差分（200 × 300）', process.execPath, ['scripts/core-diff/run.mjs', '--only', 'session', '--seeds', '200', '--steps', '300']);
step('视图分支形状覆盖（200 种子）', process.execPath, ['scripts/core-diff/view-shapes.mjs']);
step('差分驱动自检', process.execPath, ['scripts/core-diff/run.mjs', '--self-test', '--swift']);
for (const [tz, seeds] of [['Asia/Shanghai', nightly ? 5000 : 200], ['America/New_York', nightly ? 500 : 50], ['Australia/Lord_Howe', nightly ? 500 : 50], ['America/Santiago', nightly ? 500 : 50]]) {
  step(`随机差分 js ↔ swift（${tz}）`, process.execPath, ['scripts/core-diff/run.mjs', '--a', 'js', '--b', 'swift', '--seeds', String(seeds), '--steps', '300', '--tz', tz]);
}
for (const [tz, seeds] of [['Asia/Shanghai', nightly ? 2000 : 200], ['America/New_York', nightly ? 300 : 50]]) {
  step(`随机差分 store 域 js ↔ swift（${tz}）`, process.execPath, ['scripts/core-diff/run.mjs', '--a', 'js', '--b', 'swift', '--only', 'store', '--seeds', String(seeds), '--steps', '300', '--tz', tz]);
}
step('备份双向往返（Swift → JS、JS → Swift）', process.execPath, ['scripts/core-diff/backup-roundtrip.mjs', '--seeds', nightly ? '400' : '60']);
step(`调度模拟器 js ↔ swift（20 个场景${nightly ? '' : '，每个压到 30 天'}）`, process.execPath, [
  'scripts/sim/schedule-sim.mjs', '--engine', 'both', '--swift-store', 'core', ...(nightly ? [] : ['--days', '30']), '--out', path.join(ROOT, 'scripts/sim/out/both'),
]);
step('转写清单同步', process.execPath, ['scripts/core-diff/transcription-list.mjs', '--check'], { warnOnly: true });
finish();

function finish() {
  process.stdout.write('\n== 汇总\n');
  for (const r of results) process.stdout.write(`${r.ok ? '通过' : r.warnOnly ? '警告' : '失败'}  ${r.name}（${r.secs} 秒）${r.missing ? ' — 找不到命令' : ''}\n`);
  const failed = results.filter((r) => !r.ok && !r.warnOnly);
  process.exit(failed.length ? 1 : 0);
}
