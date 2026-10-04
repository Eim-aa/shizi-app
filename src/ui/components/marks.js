// 朱色白名单组件：写错的朱点、印章（落款与品牌）。
// 设计系统 v1（D33 / D43）：墨负责字，朱只负责批改与印章——朱 --zhu 只用于「写错」的朱点，印 --seal 只用于落款与品牌；
// 一屏朱色（含印）不超过两处。scripts/verify_tokens.mjs 的白名单只放行本文件：其余组件写 --zhu / --seal / --on-seal 一律报错，
// 需要这两个符号的地方在自己的样式里只管尺寸与位置，颜色由这里按类名统一给。
//   写错朱点：字库图例 / 墙格 / 筛选条 / 卡片标题（.sz-lib__dot、.sz-lib__mark）、详情列表行（.sz-drow__dot）、
//             结果页与记录页格注「写错」前面的点（[data-wrong="true"]::before）、首练结果页「没放进图里」一行（.sz-exrow__t）。同一个符号：直径 6px、正圆。
//   印章：白文「字」、直角（--r-work）；首页题记（16）、关于页（40）、字帖落款（24 / 16，作品里略倾 −2°）。
import { injectStyles, T } from './styles.js';

export const MARK_CSS = `
.sz-lib__dot,.sz-lib__mark,.sz-drow__dot{flex:none;width:6px;height:6px;border-radius:50%;background:${T.zhu}}
.sz-lib__dot{display:inline-block}
.sz-rcell__res[data-wrong="true"]::before,.sz-dcell__cap[data-wrong="true"]::before,.sz-exrow__t[data-wrong="true"]::before{content:"";display:inline-block;flex:none;
  width:6px;height:6px;margin-right:4px;border-radius:50%;background:${T.zhu};vertical-align:middle}
.sz-home__seal,.sz-about__seal,.sz-mseal{position:relative;background:${T.seal};color:${T.onSeal}}
.sz-home__seal::before,.sz-about__seal::before,.sz-mseal::before{content:"";position:absolute;inset:7%;pointer-events:none;
  box-shadow:inset 0 0 0 1px ${T.onSeal};opacity:.55}
`;

injectStyles('marks', MARK_CSS);
