// B3.7 字详情的具名检查：放大弹层里「本人墨」那一格与网页同一组笔画的像素比较（口径同 NP-07 / NP-22：parity.config.json ink，墨格取 parity/detail.json ink.states）。
// 约定见 checks/write.mjs 文件头。

export const CHECKS = [
  {
    id: 'NP-37', status: 'pass', level: '中', title: '字详情放大弹层：同一组笔画的墨粗细与网页一致（平均笔宽 ±10%）',
    states: ['detail-zoom-ink'],
    eval({ px, ink }) {
      const c = px.ink;
      if (!c || c.error) return { pass: false, detail: c ? c.error : '没有墨区取样' };
      const ok = c.web > 0 && c.native > 0 && Math.abs(c.area - 1) <= ink.thickness;
      return { pass: ok, detail: `墨面积（≈ 平均笔宽）原生 / 网页 ${c.area}（${c.native} / ${c.web} 像素）` };
    },
  },
  {
    id: 'NP-38', status: 'pass', level: '中', title: '字详情放大弹层：同一组笔画的墨区与网页重合（IoU）',
    states: ['detail-zoom-ink'],
    eval({ px, ink }) {
      const c = px.ink;
      if (!c || c.error) return { pass: false, detail: c ? c.error : '没有墨区取样' };
      const ok = c.iou1 >= ink.iou1 && c.iou >= ink.iou;
      return { pass: ok, detail: `墨区 IoU ${c.iou}（≥ ${ink.iou}）、容 1 像素 ${c.iou1}（≥ ${ink.iou1}）` };
    },
  },
];

export const COVERED_ELSEWHERE = {};
