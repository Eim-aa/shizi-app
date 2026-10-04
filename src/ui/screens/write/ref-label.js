// 参考字形的读屏名称（判断页参考卡、纸上写的对照、看答案页底栏里那个视觉隐藏的答案字；A2-09 / D45；03 P232）：
//   「参考字形：尴，gān，13 画，左右结构」 / 「…，13 画，3 个部件」；
// 字、拼音、笔画数早已读出（A9，判断页与看答案页已揭晓答案，不泄露）；这里补结构与部件数，来自 core/structure.js（部件分组 + 笔顺中线的几何推导，
// 不引入新数据；部件名「尢 + 监」读不出来——没有随 App 发布的部件数据，见 03 P232）。
// 放在单独模块里：compare.js 与 answer.js 互相引用，名称逻辑不能放在其中任何一个里（避免循环依赖）。
import { t } from '../../../config/copy/index.js';
import { describeStructure } from '../../../core/structure.js';
import { cardForKey } from '../../../data/deck.js';
import { groupsFor } from './hint-layer.js';

/** 题库里这张卡的读音（读屏名称用）；查不到给空串。 */
export function pyOf(cardKey) {
  try {
    const card = cardKey ? cardForKey(cardKey) : null;
    return card && card.py ? String(card.py) : '';
  } catch (error) {
    return '';
  }
}

/** 结构 / 部件数的读法（没有可说的给空串）。groups 缺省取题库的部件分组；medians 来自已就绪的笔顺数据。 */
export function structureText({ char, data, groups }) {
  const medians = data && Array.isArray(data.medians) ? data.medians : null;
  if (!medians) return '';
  const info = describeStructure({ groups: groups === undefined ? groupsFor(char) : groups, medians });
  if (info.structure === 'lr') return t('X-JUDGE.refStructureLr');
  if (info.structure === 'tb') return t('X-JUDGE.refStructureTb');
  if (info.parts) return t('X-JUDGE.refParts', { n: info.parts });
  return '';
}

/**
 * 参考卡的读屏名称「参考字形：嚏，tì，17 画，上下结构」（A9 / A2-09）。判断页已揭晓答案，读出字、拼音、笔画数、结构不算泄露。
 * 笔顺数据没取到时不报笔画数与结构；没有拼音时只读字。
 */
export function refCardLabel({ char, py, strokeData, groups }) {
  const pinyin = String(py || '').trim();
  if (!pinyin) return t('R-W09.refCardLabelChar', { char });
  const data = strokeData && strokeData.status === 'ready' ? strokeData.data : null;
  const n = data && Array.isArray(data.strokes) ? data.strokes.length : 0;
  const base = n > 0
    ? t('R-W09.refCardLabel', { char, pinyin, n })
    : t('R-W09.refCardLabelNoCount', { char, pinyin });
  const extra = n > 0 ? structureText({ char, data, groups }) : '';
  return extra ? t('X-JUDGE.refCardLabelPlus', { base, extra }) : base;
}
