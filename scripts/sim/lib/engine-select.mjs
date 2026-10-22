// 调度模拟器的引擎选择（B4.0 留的挂点；计划 §4.3 ③）。
//   js     现行：lib/engine.mjs 直接调 src/ 的规则（缺省）
//   swift  B4.2 起：每一步的选字 / 判断 / 跳过 / 撤销 / 更正经 ShiziCore 命令行（scripts/core-diff/lib/engines.mjs openEngine('swift')）
//   both   B4.2 起：同一步同时喂 JS 与 Swift，比整份状态（scripts/core-diff/lib/compare.mjs），27 条不变量对两边都跑
// 接入做法（B4.2）：lib/engine.mjs 里把真实 commit 函数的调用收进一个「规则适配层」对象（startNextA / commitJudgment / commitSkip …），
// js 实现 = 现有直接调用；swift 实现 = 把同名 op 发给 shizi-core-cli 并把回包里的状态写回模拟器的 store 视图；both = 两者都跑、逐步比对。
export const SIM_ENGINES = Object.freeze({
  js: { ready: true },
  swift: { ready: false, card: 'B4.2', why: 'ShiziCore 还没有出题与调度规则（sessions / session-start / fsrs …）' },
  both: { ready: false, card: 'B4.2', why: '需要 swift 引擎先就绪' },
});

/** 解析 --engine；未知名字抛错，未就绪返回 { ok: false, message }。 */
export function resolveSimEngine(name = 'js') {
  const e = SIM_ENGINES[name];
  if (!e) throw new Error(`unknown --engine ${name}（可选 ${Object.keys(SIM_ENGINES).join(' | ')}）`);
  if (!e.ready) return { ok: false, name, message: `--engine ${name} 未实现：${e.why}；由卡 ${e.card} 接入（挂点见 scripts/sim/lib/engine-select.mjs）` };
  return { ok: true, name };
}
