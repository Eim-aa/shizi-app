// 朱色白名单组件：写错的朱点、印章（落款与品牌）。
// 设计系统 v1（D33 / D43）：墨负责字，朱只负责批改与印章——朱 --zhu 只用于「写错」的朱点，印 --seal 只用于落款与品牌；
// 一屏朱色（含印）不超过两处。scripts/verify_tokens.mjs 的白名单只放行本文件：其余组件写 --zhu / --seal / --on-seal 一律报错，
// 需要这两个符号的地方在自己的样式里只管尺寸与位置，颜色由这里按类名统一给。
//   写错朱点：字库图例 / 墙格 / 筛选条 / 卡片标题（.sz-lib__dot、.sz-lib__mark）、详情列表行（.sz-drow__dot）、
//             结果页（自己选字）与记录页格注「写错」前面的点（[data-wrong="true"]::before）。同一个符号：直径 6px、正圆。
//             E9c（D49）：结果页「没放进图里」的行里朱点移到字的右上角（墨迹外框右上外 2pt），用作品朱点 .sz-work__dot--wrong（下方 WORK_MARK_CSS），不再在状态字前。
//   印章：白文、直角（--r-work）；首页首次打开（16）、关于页（40）各有自己的类；作品（结果页、月字帖、我的里的缩略图）里只有一种印——
//         <Seal/> 24pt 正放（R2-R1 / D51 ③；V2-05：一种样式、一个尺寸、不倾斜），印文只在这一个组件里取（之后换字形只改这里与 X-IMAGES.seal）。
import { html } from '../../../vendor/ui.js';
import { t } from '../../config/copy/index.js';
import { injectStyles, T } from './styles.js';

export const MARK_CSS = `
.sz-lib__dot,.sz-lib__mark,.sz-drow__dot{flex:none;width:6px;height:6px;border-radius:50%;background:${T.zhu}}
.sz-lib__dot{display:inline-block}
.sz-rcell__res[data-wrong="true"]::before,.sz-dcell__cap[data-wrong="true"]::before{content:"";display:inline-block;flex:none;
  width:6px;height:6px;margin-right:4px;border-radius:50%;background:${T.zhu};vertical-align:middle}
.sz-home__seal,.sz-about__seal{position:relative;background:${T.seal};color:${T.onSeal}}
.sz-home__seal::before,.sz-about__seal::before{content:"";position:absolute;inset:7%;pointer-events:none;
  box-shadow:inset 0 0 0 1px ${T.onSeal};opacity:.55}
`;

injectStyles('marks', MARK_CSS);

// 阶段 1 P1-E7：作品（结果页 / 月字帖）上的朱点与印。朱点 = 写错且手动放进作品的字（D46 ⑥）；作品格下一行状态字「写错」前的点同样是 6px 朱点。
// 印只有一种（R2-R1 / D51 ③）：.sz-seal，24pt 正放，白文直角，字形 17px，是图形、不随 --k（Q2-10）；位置与出现方式由使用它的组件给。
export const SEAL_PT = 24;

export const WORK_MARK_CSS = `
.sz-work__dot--wrong,.sz-work__status[data-wrong="true"]::before{background:${T.zhu}}
.sz-seal{position:relative;box-sizing:border-box;flex:none;width:${SEAL_PT}px;height:${SEAL_PT}px;display:grid;place-items:center;border-radius:${T.rWork};
  background:${T.seal};color:${T.onSeal};font-family:${T.kai};font-size:calc(17px * 1);line-height:1}
.sz-seal::before{content:"";position:absolute;inset:7%;pointer-events:none;box-shadow:inset 0 0 0 1px ${T.onSeal};opacity:.55}
`;

injectStyles('marks-work', WORK_MARK_CSS);

/**
 * 作品里的印（唯一的一种）。
 * @param {{testid?:string, style?:object|null, cls?:string}} props  style 给位置（绝对 / 相对）；cls 给出现动画等附加类
 */
export function Seal({ testid = 'work-seal', style = null, cls = '' } = {}) {
  return html`<span class=${cls ? `sz-seal ${cls}` : 'sz-seal'} aria-hidden="true" data-testid=${testid} style=${style}>${t('X-IMAGES.seal')}</span>`;
}
