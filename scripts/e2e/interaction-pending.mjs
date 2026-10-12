// 交互合规待修清单（交互与动效规范 §8b，D58 ⑥；03 P294）。
//
// 交互合规 e2e（102-interaction-compliance*.spec.js）与单测（test/ui/interaction-rules.test.mjs、test/ui/toast-kinds.test.mjs）
// 逐条断言规范 §8b 的 IC-01 – IC-21。审计清单（docs/design/交互规范-审计清单.md）里归别的卡、在这棵树上还没修的条目登记在这里：
// 对应断言**跳过并打印**（「pending P0-01 (I2): …」），不让测试假绿，也不让它红着挡住别的卡。
//
// 规则：
//   - 键是审计编号；card 是负责的卡（I2 导航 / I3 页面）；ic 是受影响的断言编号；where 用来让断言只在这些地方跳过（页面名 / 阶段 / 文案键…）。
//   - 主控合并对应的卡之后**删掉那一行**；删掉后对应断言立即生效。清空后 PENDING 为 {}。
//   - 只许删、不许加（新问题先补进规范与审计清单，再由对应的卡修）；单测 test/ui/interaction-rules.test.mjs 核对每一条都在审计清单里。
//   - Toast 不再接受 kind:'legacy'（R5M 清空后删除了这条过渡分支，test/ui/toast-kinds.test.mjs）。

export const PENDING = Object.freeze({
  // R5M（三张卡合并后）：全部条目已修，清单为空。
});

/** 某条断言在某处是否因待修条目跳过：返回命中的条目 [{id, card, why}]（空数组 = 断言照常生效）。 */
export function pendingFor(ic, where = {}) {
  const hits = [];
  for (const [id, p] of Object.entries(PENDING)) {
    if (!p.ic.includes(ic)) continue;
    const w = p.where || {};
    const keys = Object.keys(w);
    if (!keys.length || keys.some(k => (w[k] || []).some(v => [].concat(where[k] || []).includes(v)))) hits.push({ id, card: p.card, why: p.why });
  }
  return hits;
}

/** 打印一条跳过（e2e 与单测共用格式，报告里 grep「pending」即可）。 */
export function logPending(log, ic, hits, detail = '') {
  for (const h of hits) log(`pending ${h.id} (${h.card}) skips ${ic}${detail ? ` [${detail}]` : ''}: ${h.why}`);
}
