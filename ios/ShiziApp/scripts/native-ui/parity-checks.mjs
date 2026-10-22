// QA-H1：逐屏对比里的「具名检查」——两份 AI 测试报告（qa-parity 报告 NP-01…NP-21）逐条写成的可重复检查；
// 设计系统规则写成的检查用规则编号（L4-01：L4 浮条与主按钮分开，D71 ③）。
//
// status：
//   'expected-fail'  已知问题、待修复卡转绿。失败 = 「预期失败（待修）」，不算回归；通过 = 「意外通过」，提示把 status 改成 'pass'。
//   'pass'           应当通过；失败 = 回归。
// 逐项豁免不改这里，写在 parity.config.json 的 waive（编号 → 理由）：照跑照记实测值，失败不算回归。
// 每条 eval(ctx) 返回 {pass, detail}；ctx = {state, tag, appearance, size, web, native, px:{web, native}, screen}。
//   web / native：配好语义键的元素（elements.mjs）；px：在截图上的取样（compare.mjs 用 Playwright 读像素）。
// NP-01（修改 › 热区）、NP-06（判断失败三段式）要真实点按，写在 XCUITest（ShiziUITests/KnownIssueTests.swift）。

import { readFileSync } from 'node:fs';
import { colorDelta, contrastRatio, normText } from './elements.mjs';
import { STATES } from './config.mjs';

// 设计令牌（唯一来源）：L4-01 用主按钮实心底 btnBg 与门槛 toastVsPrimary（D71 ③）
const TOKENS = JSON.parse(readFileSync(new URL('../../../../docs/design/design-system-v1/tokens.json', import.meta.url), 'utf8'));

const byKey = (list, key) => list.find(e => e.key === key);
const byText = (list, re) => list.find(e => re.test(normText(e.text)));
const close = (a, b, tol) => a !== undefined && b !== undefined && Math.abs(a - b) <= tol;
const fmt = f => (f ? `(${f.x}, ${f.y}) ${f.w}×${f.h}` : '无');

/** AX-01 用：两个框的重叠面积（pt²）。 */
const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

export const CHECKS = [
  {
    // B2.9b：AX 档不溢出（交互规范 A1「不截断、不省略号」）——原生每个文字 / 按钮：字没被截断（行数够、单行放得下）、没被祖先裁掉（滚动区里滚得到的不算）、
    // 不伸出屏幕左右；同一层里（页面 / 弹层 / 确认框 / 撤销条各算一层，浮层按设计盖在页面上）文字与按钮互不重叠（重叠面积 > 1pt²）。
    id: 'AX-01', status: 'pass', level: '高', title: 'AX 档不溢出：文字完整可见、不截断、不互相压住',
    states: STATES, sizes: ['AX3', 'AX5'],
    eval({ native }) {
      const els = native.filter(e => (e.kind === 'text' || e.kind === 'button') && !e.srOnly);
      const bad = [];
      for (const e of els) {
        const name = normText(e.text) || e.id || e.prop || '?';
        if (e.truncated) bad.push(`「${name}」被截断`);
        if (e.clipped) bad.push(`「${name}」被裁掉`);
        if (e.offscreenX) bad.push(`「${name}」伸出屏幕`);
      }
      // 只比此刻看得见的部分（visibleFrame：滚动区里滚出可见框的不算重叠；null = 整个在可见框外）
      const box = e => (e.visibleFrame !== undefined ? e.visibleFrame : (e.kind === 'text' && e.textFrame ? e.textFrame : e.frame));
      for (let i = 0; i < els.length; i += 1) {
        for (let j = i + 1; j < els.length; j += 1) {
          const a = els[i], b = els[j];
          if ((a.layer || 'page') !== (b.layer || 'page')) continue;
          if (!box(a) || !box(b)) continue;
          const area = overlapArea(box(a), box(b));
          if (area > 1) bad.push(`「${normText(a.text) || a.id || a.prop}」与「${normText(b.text) || b.id || b.prop}」重叠 ${Math.round(area)}pt²`);
        }
      }
      return { pass: !bad.length, detail: bad.slice(0, 6).join('；') || `${els.length} 个元素都完整可见` };
    },
  },
  {
    id: 'NP-02', status: 'pass', level: '高', title: '首练第 1 字回忆阶段格下说明句（凭记忆写；想不起来，点下面的「提示」。）与网页一致',
    states: ['first-recall'],
    eval({ web, native }) {
      const notes = web.filter(e => e.kind === 'text' && ['write-note', 'write-first-tip'].includes(e.id) && e.text);
      if (!notes.length) return { pass: true, detail: '网页这一状态格下没有说明' };
      const miss = notes.filter(w => !native.some(n => normText(n.text) === normText(w.text)));
      return { pass: !miss.length, detail: miss.length ? `原生缺：${miss.map(m => `「${m.text}」`).join('')}` : '一致' };
    },
  },
  {
    id: 'NP-03', status: 'pass', level: '高', title: '看答案后（描一遍）题面空格里显示答案字',
    states: ['trace'],
    eval({ px }) {
      const w = px.web.blankInk, n = px.native.blankInk;
      return { pass: n >= Math.max(8, w * 0.5), detail: `空格里墨点像素 网页 ${w} 原生 ${n}` };
    },
  },
  {
    id: 'NP-04', status: 'pass', level: '高', title: '改判弹层有「看这个字 ›」',
    states: ['change-sheet'],
    eval({ native, web }) {
      const w = byText(web, /^看这个字/);
      const n = byText(native, /^看这个字/);
      return { pass: !!n || !w, detail: `网页 ${w ? '有' : '无'}，原生 ${n ? '有' : '无'}` };
    },
  },
  {
    id: 'NP-05', status: 'pass', level: '高', title: '书写格纸色格底与十字辅助线与网页一致',
    states: ['recall', 'judge', 'trace', 'retrace', 'redo', 'redo-check'],
    eval({ px, tolerance }) {
      const d = colorDelta(px.web.gridBg, px.native.gridBg);
      const bgOk = d !== null && d <= tolerance.color;
      const guideOk = (px.web.guide > 0) === (px.native.guide > 0);
      return { pass: bgOk && guideOk, detail: `格底 网页 ${px.web.gridBg} 原生 ${px.native.gridBg}（差 ${d}）；辅助线像素 网页 ${px.web.guide} 原生 ${px.native.guide}` };
    },
  },
  {
    // R11-A（D72 ②，取消 D71 ① 的豁免）：原生墨与网页同一算法。粗细 = 同一组注入笔画（中线相同）的墨面积比 = 平均笔宽比；
    // 口径与容差见 parity.config.json ink（compare.mjs inkCompare）。横画粗（单列像素）只记录。
    id: 'NP-07', status: 'pass', level: '中', title: '同一组笔画的墨粗细与网页一致（平均笔宽 ±10%）（NP-21 结果页缩略墨迹同源）',
    states: ['recall-ink', 'judge', 'last-judge', 'change-sheet', 'result', 'result-daily', 'result-first', 'result-early', 'result-undo', 'result-sheet', 'redo-ink', 'redo-check', 'redo-last'],
    eval({ px, ink }) {
      const c = px.ink;
      if (!c || c.error) return { pass: false, detail: c ? c.error : '没有墨区取样' };
      const ok = c.web > 0 && c.native > 0 && Math.abs(c.area - 1) <= ink.thickness;
      return { pass: ok, detail: `墨面积（≈ 平均笔宽）原生 / 网页 ${c.area}（${c.native} / ${c.web} 像素）；横画粗 网页 ${px.web.inkThick} 原生 ${px.native.inkThick}` };
    },
  },
  {
    id: 'NP-22', status: 'pass', level: '中', title: '同一组笔画的墨区与网页重合（R11-A，D72 ②：原生墨与网页同一算法）',
    states: ['recall-ink', 'judge', 'last-judge', 'change-sheet', 'result', 'result-daily', 'result-first', 'result-early', 'result-undo', 'result-sheet', 'redo-ink', 'redo-check', 'redo-last'],
    eval({ px, ink }) {
      const c = px.ink;
      if (!c || c.error) return { pass: false, detail: c ? c.error : '没有墨区取样' };
      const ok = c.iou1 >= ink.iou1 && c.iou >= ink.iou;
      return { pass: ok, detail: `墨区 IoU ${c.iou}（≥ ${ink.iou}）、容 1 像素 ${c.iou1}（≥ ${ink.iou1}）` };
    },
  },
  {
    id: 'NP-08', status: 'pass', level: '中', title: '页头阶段标题（描一遍 / 凭记忆写 / 写对了吗）字号、字重、颜色与网页一致',
    states: ['trace', 'retrace', 'judge'],
    eval({ web, native, tolerance }) {
      const w = web.find(e => e.tag === 'h1' && !e.srOnly);
      const n = byKey(native, 'title');
      // B2.9b：AX 档判断页的标题只给读屏（网页 hideTitle，D49 ⑧）——两边都没有可见标题 = 一致
      if (!w && !n) return { pass: true, detail: '两边标题都只给读屏' };
      if (!w || !n) return { pass: false, detail: `标题 网页 ${w ? w.text : '无'} 原生 ${n ? n.text : '无'}` };
      const ok = close(w.fontSize, n.fontSize, tolerance.font) && close(w.fontWeight, n.fontWeight, tolerance.weight) && (colorDelta(w.color, n.color) ?? 999) <= tolerance.color;
      return { pass: ok, detail: `网页 ${w.fontSize}pt/${w.fontWeight}/${w.color} 原生 ${n.fontSize}pt/${n.fontWeight}/${n.color}` };
    },
  },
  {
    id: 'NP-09', status: 'pass', level: '中', title: '提示 / 看答案 / 撤销 / 清空的图标尺寸与网页一致、不随字号放大（NP-18 同源）',
    states: ['recall'],
    eval({ web, native, tolerance }) {
      const bad = [];
      for (const k of ['hint', 'show-answer', 'undo', 'clear']) {
        const w = byKey(web, k), n = byKey(native, k);
        if (!w || !n || !w.iconFrame || !n.iconFrame) { bad.push(`${k}: 网页图标 ${fmt(w && w.iconFrame)} 原生 ${fmt(n && n.iconFrame)}`); continue; }
        if (!close(w.iconFrame.w, n.iconFrame.w, tolerance.size) || !close(w.iconFrame.h, n.iconFrame.h, tolerance.size)) bad.push(`${k}: 网页 ${w.iconFrame.w}×${w.iconFrame.h} 原生 ${n.iconFrame.w}×${n.iconFrame.h}`);
      }
      return { pass: !bad.length, detail: bad.join('；') || '一致' };
    },
  },
  {
    id: 'NP-10', status: 'pass', level: '中', title: '改判弹层是满宽贴底抽屉、底色与网页一致',
    states: ['change-sheet'],
    eval({ web, native, screen, tolerance }) {
      const w = byKey(web, 'sheet'), n = byKey(native, 'sheet');
      if (!n) return { pass: false, detail: '原生没有找到弹层视图' };
      const full = close(n.frame.x, 0, 1) && close(n.frame.w, screen.w, 1) && close(n.frame.y + n.frame.h, screen.h, 1);
      const d = colorDelta(w && w.bg, n.bg);
      return { pass: full && d !== null && d <= tolerance.color, detail: `原生弹层 ${fmt(n.frame)} 底 ${n.bg || '无'}；网页 ${fmt(w && w.frame)} 底 ${w && w.bg}` };
    },
  },
  {
    id: 'NP-11', status: 'pass', level: '中', title: '看答案流程说明句左对齐（与网页同位置）',
    states: ['trace', 'retrace'],
    eval({ web, native, tolerance }) {
      const w = web.find(e => e.id === 'write-note' && e.text);
      if (!w) return { pass: true, detail: '网页这一状态没有说明句' };
      const n = native.find(e => normText(e.text) === normText(w.text));
      if (!n) return { pass: false, detail: `原生没有「${w.text}」` };
      const ok = close((w.textFrame || w.frame).x, (n.textFrame || n.frame).x, tolerance.pos);
      return { pass: ok, detail: `文字左缘 网页 ${(w.textFrame || w.frame).x} 原生 ${(n.textFrame || n.frame).x}（${n.align || '?'}）` };
    },
  },
  {
    id: 'NP-12', status: 'pass', level: '中', title: '主按钮「写好了」（可点）底色与网页一致（深色）',
    states: ['recall-ink'], appearances: ['dark'],
    eval({ web, native, tolerance }) {
      const w = byKey(web, 'primary'), n = byKey(native, 'primary');
      const d = colorDelta(w && w.bg, n && n.bg);
      return { pass: d !== null && d <= tolerance.color, detail: `网页 ${w && w.bg} 原生 ${n && n.bg}` };
    },
  },
  {
    id: 'NP-13', status: 'pass', level: '中', title: '判断页两格方角、共用格线、纸色填充',
    states: ['judge', 'last-judge'],
    eval({ web, native, tolerance }) {
      const bad = [];
      for (const k of ['grid', 'ref-grid']) {
        const w = byKey(web, k), n = byKey(native, k);
        if (!n) { bad.push(`${k} 原生无`); continue; }
        if ((n.radius || 0) > 0.5 && !((w && w.radius) > 0.5)) bad.push(`${k} 原生圆角 ${n.radius}`);
        const d = colorDelta(w && w.bg, n.bg || '#00000000');
        if (w && w.bg && (d === null || d > tolerance.color)) bad.push(`${k} 填充 网页 ${w.bg} 原生 ${n.bg || '无'}`);
      }
      return { pass: !bad.length, detail: bad.join('；') || '一致' };
    },
  },
  {
    id: 'NP-14', status: 'pass', level: '中', title: '格下结果行字号与「修改 ›」位置与网页一致',
    states: ['line'],
    eval({ web, native, tolerance }) {
      const wt = byKey(web, 'line-text'), nt = byKey(native, 'line-text');
      const wc = byKey(web, 'line-change'), nc = byKey(native, 'line-change');
      const bad = [];
      if (!wt || !nt) bad.push('结果行缺');
      else if (!close(wt.fontSize, nt.fontSize, tolerance.font)) bad.push(`字号 网页 ${wt.fontSize} 原生 ${nt.fontSize}`);
      if (wc && nc && !close((wc.textFrame || wc.frame).x, (nc.textFrame || nc.frame).x, tolerance.pos)) bad.push(`「修改 ›」文字左缘 网页 ${(wc.textFrame || wc.frame).x} 原生 ${(nc.textFrame || nc.frame).x}`);
      return { pass: !bad.length, detail: bad.join('；') || '一致' };
    },
  },
  {
    id: 'NP-15', status: 'pass', level: '低', title: '页头「跳过」「结束这组」字号与位置与网页一致',
    states: ['recall'],
    eval({ web, native, tolerance }) {
      const bad = [];
      for (const k of ['skip', 'end']) {
        const w = byKey(web, k), n = byKey(native, k);
        if (!w || !n) { bad.push(`${k} 缺`); continue; }
        if (!close(w.fontSize, n.fontSize, tolerance.font)) bad.push(`${k} 字号 网页 ${w.fontSize} 原生 ${n.fontSize}`);
        if (!close((w.textFrame || w.frame).x, (n.textFrame || n.frame).x, tolerance.pos)) bad.push(`${k} 文字左缘 网页 ${(w.textFrame || w.frame).x} 原生 ${(n.textFrame || n.frame).x}`);
      }
      return { pass: !bad.length, detail: bad.join('；') || '一致' };
    },
  },
  {
    id: 'NP-16', status: 'pass', level: '低', title: '返回「‹」图标尺寸与网页一致',
    states: ['recall'],
    eval({ web, native, tolerance }) {
      const w = byKey(web, 'back'), n = byKey(native, 'back');
      const ok = w && n && w.iconFrame && n.iconFrame && close(w.iconFrame.w, n.iconFrame.w, tolerance.size) && close(w.iconFrame.h, n.iconFrame.h, tolerance.size);
      return { pass: !!ok, detail: `网页 ${fmt(w && w.iconFrame)} 原生 ${fmt(n && n.iconFrame)}` };
    },
  },
  {
    id: 'NP-17', status: 'pass', level: '低', title: '题面与书写格的纵向位置与网页一致（±1pt）',
    states: ['recall'],
    eval({ web, native, tolerance }) {
      const w = byKey(web, 'grid'), n = byKey(native, 'grid');
      const ok = w && n && close(w.frame.y, n.frame.y, tolerance.pos) && close(w.frame.h, n.frame.h, tolerance.size);
      return { pass: !!ok, detail: `书写格 网页 ${fmt(w && w.frame)} 原生 ${fmt(n && n.frame)}` };
    },
  },
  {
    id: 'NP-19', status: 'pass', level: '低', title: '跳过撤销条高度与离求助键的间距与网页一致（±2pt）',
    states: ['skip-undo'],
    eval({ web, native }) {
      const w = byKey(web, 'undo-bar'), n = byKey(native, 'undo-bar');
      const wh = byKey(web, 'hint'), nh = byKey(native, 'hint');
      if (!w || !n || !wh || !nh) return { pass: false, detail: `撤销条 网页 ${fmt(w && w.frame)} 原生 ${fmt(n && n.frame)}` };
      const wg = wh.frame.y - (w.frame.y + w.frame.h), ng = nh.frame.y - (n.frame.y + n.frame.h);
      return { pass: close(w.frame.h, n.frame.h, 2) && close(wg, ng, 2), detail: `条高 网页 ${w.frame.h} 原生 ${n.frame.h}；与求助键间距 网页 ${Math.round(wg)} 原生 ${Math.round(ng)}` };
    },
  },
  {
    id: 'L4-01', status: 'pass', level: '高', title: '浮条底色 ≠ 主按钮底色，且两者色差足够大（对比度 ≥ toastVsPrimary）；浮条圆角大于主按钮（D71 ③）',
    states: ['skip-undo'],
    eval({ web, native, appearance }) {
      const minRatio = TOKENS.color.contrast.thresholds.toastVsPrimary;
      const btnBg = (TOKENS.color[appearance] || {}).btnBg;
      const bad = [], info = [];
      for (const [side, list] of [['网页', web], ['原生', native]]) {
        const bar = byKey(list, 'undo-bar');
        if (!bar || !bar.bg) { bad.push(`${side}没有撤销条或取不到底色`); continue; }
        const primary = byKey(list, 'primary');
        // 主按钮实心底：令牌 btnBg；同屏主按钮可点时再拿它的实际底色比一次（不可点时是 field 底，不代表主按钮的实心色）
        const refs = [['btnBg', `${btnBg}FF`]];
        if (primary && primary.enabled && primary.bg) refs.push(['同屏主按钮', primary.bg]);
        for (const [name, c] of refs) {
          const r = contrastRatio(bar.bg, c);
          const same = colorDelta(bar.bg, c) === 0;
          if (same || r === null || r < minRatio) bad.push(`${side}浮条 ${bar.bg} 对${name} ${c} 对比度 ${r === null ? '?' : r.toFixed(2)}${same ? '（同色）' : ''} < ${minRatio}`);
          else info.push(`${side}对${name} ${r.toFixed(1)}`);
        }
        const pr = (primary && primary.radius) || 12;
        if (!((bar.radius || 0) > pr)) bad.push(`${side}浮条圆角 ${bar.radius || 0} 不大于主按钮 ${pr}`);
      }
      return { pass: !bad.length, detail: bad.join('；') || info.join('，') };
    },
  },
  {
    id: 'NP-20', status: 'pass', level: '低', title: '弹层 / 确认框遮罩深浅与网页一致',
    states: ['change-sheet', 'end-dialog'],
    eval({ px, tolerance }) {
      const d = colorDelta(px.web.scrim, px.native.scrim);
      return { pass: d !== null && d <= tolerance.color, detail: `遮罩处取样 网页 ${px.web.scrim} 原生 ${px.native.scrim}（差 ${d}）` };
    },
  },
];

/** 报告里 NP 编号的覆盖说明（没写成逐屏检查的条目在哪里）。 */
export const COVERED_ELSEWHERE = {
  'NP-01': 'XCUITest KnownIssueTests.testNP01_changeLinkWholeHitArea（真实点按「修改 ›」44pt 热区上沿；R9-B 修好，普通断言）',
  'NP-06': 'XCUITest KnownIssueTests.testNP06_judgeSaveFailureThreeSteps（-shizi-qa-fail-next 注入写失败）',
  'NP-18': '并入 NP-09（撤销 / 清空图标）',
  'NP-21': '并入 NP-07 / NP-22（原生墨与网页同一算法 buildStroke；B2.7 结果页原生后作品格的墨同样按像素比）',
};
