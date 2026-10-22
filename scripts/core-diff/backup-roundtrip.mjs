#!/usr/bin/env node
// 备份双向往返的实跑核对（B4.4；计划 §4.4）：
//   Swift → JS：shizi-core-cli 上 seed 一份状态、导出备份文件 → JS 参考引擎（另一种后端）恢复它 → 恢复后的白名单域与原状态相同；
//   JS → Swift：JS 导出 → Swift 恢复 → 同上；两边恢复后的整份状态快照（状态 / 磁盘 / status）还要彼此相同。
// 状态取随机差分 store 域的同一个工厂（N 个种子）。退出码：0 全部一致；1 有不同；2 没编命令行。
//   node scripts/core-diff/backup-roundtrip.mjs [--seeds 60]
process.env.TZ = process.env.TZ || 'Asia/Shanghai';
const { openEngine } = await import('./lib/engines.mjs');
const { makeCtx, rng } = await import('./lib/gen.mjs');
const { storeState, STORE_T0 } = await import('./domains/store.mjs');
const { BACKUP_WHITELIST } = await import('../../src/core/schema.js');

const argv = process.argv.slice(2);
const seeds = argv.includes('--seeds') ? Number(argv[argv.indexOf('--seeds') + 1]) : 60;

let js;
let sw;
try {
  js = openEngine('js');
  sw = openEngine('swift');
} catch (e) {
  console.log(e.message);
  process.exit(2);
}
const call = async (e, op, args) => JSON.parse(await e.send(JSON.stringify({ op, args })));
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const pickWhitelist = (s) => {
  const o = {};
  for (const d of BACKUP_WHITELIST) {
    if (d === 'backupMeta' || d === 'meta') continue; // 本机日期 / 结论与序号由恢复改写（K02）
    o[d] = s[d];
  }
  return JSON.stringify(sortKeys(o));
};

let bad = 0;
let checked = 0;
for (let seed = 1; seed <= seeds; seed += 1) {
  const s = storeState(makeCtx(rng(seed)));
  const exports = {};
  let skip = false;
  for (const [name, e] of [['js', js], ['swift', sw]]) {
    await call(e, 'reset', {});
    await call(e, 'store.open', { backend: 'local', clock: STORE_T0 });
    const seeded = await call(e, 'store.seed', { state: s });
    if (!seeded.reply.ok) skip = true;
    exports[name] = { text: (await call(e, 'backup.export', {})).reply, state: seeded.state.store.state };
  }
  if (skip) continue;
  checked += 1;
  if (exports.js.text !== exports.swift.text) {
    bad += 1;
    console.log(`种子 ${seed}：导出的文件不同`);
    continue;
  }
  // 交叉恢复：Swift 的文件给 JS，JS 的文件给 Swift（两种后端轮换）
  const backend = seed % 2 ? 'native' : 'local';
  const restored = {};
  for (const [name, e, text] of [['js', js, exports.swift.text], ['swift', sw, exports.js.text]]) {
    await call(e, 'reset', {});
    await call(e, 'store.open', { backend, clock: STORE_T0 + 3600000 });
    const r = await call(e, 'backup.restore', { input: text });
    restored[name] = r;
    if (!r.reply.result || !r.reply.result.ok) {
      bad += 1;
      console.log(`种子 ${seed}：${name} 恢复失败 ${JSON.stringify(r.reply).slice(0, 300)}`);
    }
  }
  if (JSON.stringify(restored.js.state.store) !== JSON.stringify(restored.swift.state.store)) {
    bad += 1;
    console.log(`种子 ${seed}：两边恢复后的状态快照不同`);
  }
  if (pickWhitelist(restored.js.state.store.state) !== pickWhitelist(exports.js.state)) {
    bad += 1;
    console.log(`种子 ${seed}：恢复后的记录 / 墨迹 / 调度与导出前不同`);
  }
}
await js.close();
await sw.close();
console.log(`备份双向往返：${checked} 份状态（Swift → JS、JS → Swift，两种后端），${bad ? bad + ' 处不同' : '0 差异'}`);
process.exit(bad ? 1 : 0);
