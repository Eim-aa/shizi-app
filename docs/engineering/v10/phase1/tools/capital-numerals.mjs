// D40「写写大写数字」特别组的数据（P1-E4，工程起草，待语文/书法顾问审读）。
//
// 大写数字（壹贰叁肆伍陆柒捌玖拾佰仟）不进默认新字排序（D40），做成一次性的两组特别组：
// 累计写满约 10 组后、积压不重的那天，日常练习换成「壹贰叁肆伍」「陆柒捌玖拾」两组，题面用借条 / 报销单 / 红包等真实语境；
// 写完后按普通字进入 FSRS。佰、仟不放进这两组，之后进入普通新字队列的最前（见 AFTER_GROUPS）。
// 改这里后重跑：node scripts/build_char_order.mjs
//
// 语境词只在特别组里用（运行时 src/ui/screens/write/index.js 在整组都是大写数字字时才套用，不改全库的语境词，
// 也不动内容门禁管的 deck-data.js / context-overrides.js）。每个词都是起草者的人工判断：避开真实人名，
// 目标字在词里只出现一次，提示句不含答案字。

/** 两组特别组（D40）：每组一个特别组，按顺序出现。 */
export const GROUPS = [
  ['壹', '贰', '叁', '肆', '伍'],
  ['陆', '柒', '捌', '玖', '拾'],
];

/** 两组特别组之后、进入普通新字队列最前的字。 */
export const AFTER_GROUPS = ['佰', '仟'];

/**
 * 题面语境：字 → {word 词, ci 目标字在词里的位置, py 目标字拼音, promptHint 题面可见的一句提示}。
 * 提示句只说明在哪里用、不含答案字。
 */
export const CONTEXTS = {
  壹: { word: '壹佰元整', ci: 0, py: 'yī', promptHint: '借条上写的金额' },
  贰: { word: '贰仟元整', ci: 0, py: 'èr', promptHint: '借条上写的金额' },
  叁: { word: '叁佰元整', ci: 0, py: 'sān', promptHint: '借条上写的金额' },
  肆: { word: '肆仟元整', ci: 0, py: 'sì', promptHint: '借条上写的金额' },
  伍: { word: '伍佰元整', ci: 0, py: 'wǔ', promptHint: '借条上写的金额' },
  陆: { word: '陆佰元整', ci: 0, py: 'liù', promptHint: '报销单上写的金额' },
  柒: { word: '柒拾元整', ci: 0, py: 'qī', promptHint: '报销单上写的金额' },
  捌: { word: '捌佰元整', ci: 0, py: 'bā', promptHint: '红包封面上写的金额' },
  玖: { word: '玖拾元整', ci: 0, py: 'jiǔ', promptHint: '红包封面上写的金额' },
  拾: { word: '壹拾元整', ci: 1, py: 'shí', promptHint: '收据上写的金额' },
  佰: { word: '壹佰元整', ci: 1, py: 'bǎi', promptHint: '收据上写的金额' },
  仟: { word: '壹仟元整', ci: 1, py: 'qiān', promptHint: '收据上写的金额' },
};

/** 全部大写数字字（不进默认新字排序）。 */
export const ALL = [...GROUPS.flat(), ...AFTER_GROUPS];
