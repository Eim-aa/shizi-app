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
//   - Toast 的 kind:'legacy' 调用必须带这里登记过的审计编号（test/ui/toast-kinds.test.mjs）。

export const PENDING = Object.freeze({
  // ---- 卡 I2（导航 §1）
  'P0-01': { card: 'I2', ic: ['IC-01', 'IC-02', 'IC-03', 'IC-04'], where: { phases: ['compare'] }, why: '判断阶段左缘右滑被关掉（Page lead → useBackAction(null)）' },
  'P0-16': { card: 'I2', ic: ['IC-08'], where: {}, why: '读屏两指 Z 形 / Esc 在没有弹层的子页上不等于点左上' },
  'P1-04': { card: 'I2', ic: ['IC-01'], where: { screens: ['detail-photo'] }, why: '字详情「旧版本的记录」推入页用「×」' },
  'P1-05': { card: 'I2', ic: ['IC-01', 'IC-10'], where: { screens: ['session-none'] }, why: '「现在没有要写的字」推入页用「×」，底部「回首页」与 × 不同' },
  'P1-01': { card: 'I2', ic: ['IC-03'], where: { screens: ['result'] }, why: '结果页「×」回 Tab 根时硬切，右滑却有 B1 收回' },
  'P2-17': { card: 'I2', ic: ['IC-07'], where: { exits: ['esc'] }, why: 'Esc 直接 router.back()，绕过确认框 / S02 自定义的取消动作（与 P0-16 同一处处理器）' },
  // ---- 卡 I3（按钮与页面 §3、成功提示删除）
  'P0-07': { card: 'I3', ic: ['IC-12'], where: { copy: ['X-WORK.saved'] }, why: '图片保存成功提示「存好了」' },
  'P0-08': { card: 'I3', ic: ['IC-12'], where: { copy: ['X-LIBSWITCH.switchedToast'] }, why: '换库成功提示' },
  'P0-09': { card: 'I3', ic: ['IC-12'], where: { copy: ['X-BACKUP.exported'] }, why: '导出备份成功提示' },
  'P0-10': { card: 'I3', ic: ['IC-12'], where: { copy: ['R-H05.oldGroupSavedToast'] }, why: '结束旧组开新组的保存成功提示' },
  'P0-11': { card: 'I3', ic: ['IC-12'], where: { copy: ['R-W15.zeroToast'] }, why: '零判断结束这组的提示' },
  'P0-13': { card: 'I3', ic: ['IC-12'], where: { copy: ['X-SETTINGS.textSizeNotice'] }, why: '文字大小迁移说明提示条' },
  'P0-14': { card: 'I3', ic: ['IC-12'], where: { copy: ['R-Q05.added'] }, why: '查字加入自选成功提示' },
  'P1-14': { card: 'I3', ic: ['IC-10'], where: { screens: ['home'] }, why: '首页启动失败时同屏两个主按钮' },
  'P1-15': { card: 'I3', ic: ['IC-10'], where: { screens: ['write', 'result', 'home'] }, why: '主按钮底线三四种算法（写字页 max(8, 安全区)、首页 Tab 上沿 + 24）' },
  'P1-16': { card: 'I3', ic: ['IC-10'], where: { screens: ['backup'] }, why: '备份页主按钮在正文中间，不在底线' },
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
