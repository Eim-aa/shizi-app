// 重写错字（D66 ③；B2.9a）的纯模型：要重写的字表（网页 write/redo.js 与写字会话 API 的 redoOpen / redoNext 共用同一个函数）。
// 只算练习：本模块不读写 store，不产生任何记录。

import { isPracticable } from '../../data/deck.js';

/** 要重写的字：单个汉字、题库里能练的，去重，保持原顺序。 */
export function redoCharsOf(params) {
  const raw = params && Array.isArray(params.chars) ? params.chars : [];
  const seen = new Set();
  const out = [];
  for (const c of raw) {
    if (typeof c !== 'string' || Array.from(c).length !== 1 || seen.has(c) || !isPracticable(`base:${c}`)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** 重写错字页的题面队列（网页 RedoScreen 的 queue：整组大写数字字时题面用借条语境，data/deck.js capitalCard 读它）。 */
export function redoQueueOf(chars) {
  return chars.map(c => `base:${c}`);
}
