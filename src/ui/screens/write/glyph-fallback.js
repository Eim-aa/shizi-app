// 10.13 无笔顺数据分支（01-架构设计 §6.4–6.5；04 R-W05 / R-W08；原型 ShiziWriteScreen L484–L488、L500、L526–L545）。
//
// 笔画数据取不到（src/data/strokes.js 返回 null，或 hanzi-writer 失败）时：
// - 没有分步提示：提示按钮位置换成灰字「暂时没有提示」（R-W05.hintUnavailable；原型 'txt' 态：13px、--i3、不可点）；
//   书写格下说明「这个字暂时没有提示，可以直接看答案。」（R-W05.noHintNote）。
// - 看答案 / 对照 / 描一遍：完整楷体整字，用 DOM 文本（不是 canvas），字体 var(--kai)（ShiziKai，M5 接入前回退系统楷体，§8.4）；
//   描一遍用浅色（--tf）整字、不分笔顺，格下「浅色是参考字形。」（R-W08.traceNote）；
//   看答案说明「这个字记为看过答案，后面再写只算练习。」（R-W08.answerNote）。
// 文案一律取 src/config/copy/。回忆阶段不要渲染 GlyphFallback（答案字不能出现在回忆阶段，M1-8）。
//
// 给 M1-3 / M1-4 / M1-5 的接口：
//   <GlyphFallback char variant='answer'|'trace'|'reference' size testid? />   叠在书写格 / 对照卡里（父元素 position:relative）
//   <NoHintLabel />                                                            提示按钮位置上的灰字
//   fallbackCopy()                                                             四条说明文案
import { html } from '../../../../vendor/ui.js';
import { t } from '../../../config/copy/index.js';
import { injectStyles, T } from '../../components/styles.js';

/** 10.13 相关文案（每次现取，文案表是冻结常量）。 */
export function fallbackCopy() {
  return {
    hintUnavailable: t('R-W05.hintUnavailable'),
    noHintNote: t('R-W05.noHintNote'),
    answerNote: t('R-W08.answerNote'),
    traceNote: t('R-W08.traceNote'),
  };
}

// 字号 = 格边长 × 0.78，基线在中心下方 3%（原型 refGlyphC：font (S*.78)px、y = S/2 + S*.03、dominant-baseline central）。
export const FALLBACK_FONT_RATIO = 0.78;
export const FALLBACK_OFFSET_RATIO = 0.03;

const VARIANT_COLOR = Object.freeze({
  answer: 'var(--ref, #5D5952)',
  reference: 'var(--ref, #5D5952)',
  trace: 'var(--tf, #EBE6DE)',
});

injectStyles('glyph-fallback', `
.sz-glyph-fb{position:absolute;left:0;top:0;display:flex;align-items:center;justify-content:center;
  pointer-events:none;user-select:none;-webkit-user-select:none;font-family:var(--kai, "Kaiti SC", "STKaiti", "KaiTi", serif);
  font-weight:400;line-height:1;font-synthesis:none}
.sz-glyph-fb__char{display:block;line-height:1}
.sz-nohint{min-height:52px;display:flex;align-items:center;font-size:calc(13px * ${T.k});line-height:1.45;color:${T.i3};
  text-wrap:pretty}
`);

/**
 * 楷体整字。父元素须 position:relative（与书写格 / 对照卡同尺寸）。
 * @param {object} props
 * @param {string} props.char
 * @param {'answer'|'trace'|'reference'} [props.variant='answer']
 * @param {number} [props.size=345]  CSS px 边长
 * @param {string} [props.testid='write-glyph-fallback']
 */
export function GlyphFallback({ char, variant = 'answer', size = 345, testid = 'write-glyph-fallback' }) {
  const color = VARIANT_COLOR[variant] || VARIANT_COLOR.answer;
  const style = `width:${size}px;height:${size}px;color:${color};font-size:${Math.round(size * FALLBACK_FONT_RATIO * 100) / 100}px`;
  const shift = `transform:translateY(${Math.round(size * FALLBACK_OFFSET_RATIO * 100) / 100}px)`;
  return html`<div class="sz-glyph-fb" data-testid=${testid} data-variant=${variant} style=${style}>
    <span class="sz-glyph-fb__char" lang="zh-CN" style=${shift}>${char}</span>
  </div>`;
}

/** 提示按钮位置的灰字「暂时没有提示」（不是按钮，不可点）。 */
export function NoHintLabel({ testid = 'write-hint-unavailable' } = {}) {
  return html`<span class="sz-nohint" data-testid=${testid}>${t('R-W05.hintUnavailable')}</span>`;
}
