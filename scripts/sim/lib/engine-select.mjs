// 调度模拟器的引擎选择（B4.0 留的挂点，B4.2 接入；计划 §4.3 ③）。
//   js     现行：lib/engine.mjs 经 lib/rules.mjs 直接调 src/ 的规则（缺省）
//   swift  选字 / 开组 / 过期 / 判断 / 跳过 / 撤销 / 看答案 / 改判里的规则经 ShiziCore 命令行（lib/sync-engine.mjs 同步调用），
//          记录构造与存储仍走 JS 的真实 store；27 条不变量照常在 JS 上量 Swift 算出的状态
//   both   两个 store 同步走（主 = js、影子 = swift），每一步比回包与整份状态，差异记在报告里；有差异退出码 1
// 需要先编好命令行：swift build -c release --package-path ios/ShiziCore（scripts/core-diff/lib/engines.mjs swiftBin）。
export const SIM_ENGINES = Object.freeze({
  js: { ready: true },
  swift: { ready: true },
  both: { ready: true },
});

/** 解析 --engine；未知名字抛错，未就绪返回 { ok: false, message }。 */
export function resolveSimEngine(name = 'js') {
  const e = SIM_ENGINES[name];
  if (!e) throw new Error(`unknown --engine ${name}（可选 ${Object.keys(SIM_ENGINES).join(' | ')}）`);
  if (!e.ready) return { ok: false, name, message: `--engine ${name} 未实现：${e.why}；由卡 ${e.card} 接入（挂点见 scripts/sim/lib/engine-select.mjs）` };
  return { ok: true, name };
}
