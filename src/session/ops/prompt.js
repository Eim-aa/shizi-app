// 题面模型（词语格、拼音、读屏名称；从 src/ui/screens/write/prompt.js 原样挪来，B2.1；行为不变）。视图仍在 prompt.js。

import { promptModel } from '../../core/cards.js';
import { t } from '../../config/copy/index.js';

/** 这些阶段题面把目标字填回空格（原型 L527）；recall / retrace 一律遮住。D49：判断页（compare）的目标格也不显示答案，答案只在参考格出现一次。 */
export const REVEAL_PHASES = Object.freeze(['answer', 'trace']);

let copyCache = null;
/** cards.js PROMPT_COPY 的同形对象，值取自 src/config/copy/（R-W28、X-PROMPT）。 */
export function promptCopy() {
  if (!copyCache) {
    copyCache = Object.freeze({
      repeatInstruction: t('R-W28.repeatBlankNote'),
      fallbackHint: t('X-PROMPT.fallbackHint'),
      repeatBlankLabel: t('X-PROMPT.repeatBlankLabel'),
      missingPinyin: t('X-PROMPT.missingPinyin'),
      repeatBlankGlyph: t('X-PROMPT.repeatBlankGlyph'),
    });
  }
  return copyCache;
}

// ---- 纯模型 ------------------------------------------------------------------------------------------------

const TONE_MARKS = Object.freeze({ '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 });

/** 拼音声调（1–4；没有声调符号 = 5 轻声）：zhāng → 1，gān → 1，tì → 4，ma → 5。 */
export function toneOfPinyin(py) {
  for (const ch of String(py || '').normalize('NFD')) {
    if (Object.prototype.hasOwnProperty.call(TONE_MARKS, ch)) return TONE_MARKS[ch];
  }
  return 5;
}

/**
 * 回忆阶段空格（要写的字）的读屏名称：「要写的字，第 1 个，读 gān，一声」（A9；单字题不报位置）。
 * 只由位置、拼音、声调决定，不含答案字（D16）。揭示阶段（判断 / 看答案 / 描一遍）格里是答案字的文本，
 * 不设 role=img / 名称（会把字藏起来），读屏顺着文本读「拼音、字」。拼音缺失（占位「？」）时也不给名称。
 */
export function blankLabel({ py, index, count }) {
  const pinyin = String(py || '').trim();
  if (!pinyin) return null;
  return t(count > 1 ? 'X-PROMPT.blankLabel' : 'X-PROMPT.blankLabelSingle', { n: index + 1, pinyin, tone: t(`X-PROMPT.tone${toneOfPinyin(pinyin)}`) });
}

/**
 * 题面格与提示行（纯函数，node:test 可测）。
 * @returns {{cells: Array<{kind:'text'|'blank'|'repeatBlank', text:string, label:string|null, fill:string|null}>,
 *            hint:string, blankIndex:number, count:number}}
 *   text：该格可见文字（blank 为拼音；repeatBlank 为 □，揭示后为目标字）；fill：揭示时 blank 格里的目标字。
 */
export function promptCells(card, { revealed = false, copy = promptCopy() } = {}) {
  if (!card || !Array.isArray(card.chars)) return { cells: [], hint: '', blankIndex: -1, count: 0 };
  const model = promptModel(card, copy);
  const cells = model.segments.map((seg, i) => {
    if (seg.kind === 'blank') {
      return { kind: 'blank', text: seg.text, label: revealed ? null : blankLabel({ py: card.py, index: i, count: card.chars.length }), fill: revealed ? card.target : null };
    }
    if (seg.kind === 'repeatBlank') {
      return revealed
        ? { kind: 'repeatBlank', text: card.target, label: null, fill: null }
        : { kind: 'repeatBlank', text: seg.text, label: seg.label, fill: null };
    }
    return { kind: 'text', text: seg.text, label: null, fill: null };
  });
  const blankIndex = cells.findIndex(c => c.kind === 'blank');
  return { cells, hint: model.visibleHint, blankIndex, count: cells.length };
}
