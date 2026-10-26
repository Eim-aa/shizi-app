// 墨迹点列的整理（纯函数，无 DOM；B3.9 从 ui/screens/write/compare.js 与 ui/components/work.js 挪到 core）。
//
//   builtFromRaw  原始笔画（每笔一串采样点）→ 管线点列（buildStroke，与网页 ink-math.js 同一算法）。
//   builtInk      本人墨 {points, strokes} → 管线点列 | null（有墨才返回）。
//
// 为什么挪：月字帖 / 年报 / 练习记录的视图模型（src/session/views/）要画格子里的墨，会话层不能导入 UI 模块，
// 所以这两个纯函数先落到 core（网页侧从新位置 import，行为不变）。
import { buildStroke } from './ink-math.js';

/** 原始笔画 → 管线点列（每笔一串带宽度的点）。 */
export function builtFromRaw(strokes) {
  return (strokes || []).filter(s => Array.isArray(s) && s.length).map(raw => buildStroke(raw, { final: true }));
}

/** 本人墨：{points, strokes}（detail/views 的 inkOf 形状）→ 管线点列 | null。 */
export function builtInk(ink) {
  if (!ink) return null;
  const built = Array.isArray(ink.points) && ink.points.length ? ink.points : Array.isArray(ink.strokes) && ink.strokes.length ? builtFromRaw(ink.strokes) : null;
  return built && built.some(s => Array.isArray(s) && s.length) ? built : null;
}
