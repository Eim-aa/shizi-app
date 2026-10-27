// 换库列表的视图模型（B3.4：从 ui/screens/library/switch.js 挪来；无 DOM、无 Preact）。库名 / 说明 / 数量行只给「文案键 + 参数」，网页用 tRef 渲染。

import { lineStarts } from '../../core/line-starts.js';
import { ref, tRef } from '../../config/copy/index.js';
import { LIBRARIES } from '../../core/cards.js';
import { flattenRecords } from '../../core/query.js';
import { isJudged } from '../../core/records.js';
import { currentLibraryId, libraryOf } from '../../data/deck.js';

/** 库名 / 一句说明的文案引用（copy R-L06.lib.<id>.*）。 */
export function libraryNameRef(id) {
  return ref(`R-L06.lib.${id}.name`);
}

export function libraryDescRef(id) {
  return ref(`R-L06.lib.${id}.desc`);
}

/**
 * 有记录的字（D23：写对 / 写错的 judged 记录，按字去重）。records 域为按月对象（含折叠月的 kept）。
 * @returns {Set<string>} 字
 */
export function judgedChars(state) {
  const out = new Set();
  const records = flattenRecords(state && state.records);
  for (const r of records) if (isJudged(r) && typeof r.char === 'string' && r.char) out.add(r.char);
  return out;
}

/**
 * 换库列表的行模型。
 * @param {object|null} state            store 状态（settings / records）
 * @param {object} [o]
 * @param {(id:string) => {keys:string[]}|null} [o.libraryOf]   库 → 题库里属于该库的 cardKey（默认 data/deck.js）
 * @param {(settings) => string} [o.currentId]                  当前库 id（默认 data/deck.js：settings.library → P73 默认库）
 * @returns {{id, name, desc, total, recorded, current, countLine}[]}  name / desc / countLine 是文案引用
 */
export function libraryRows(state, { libraryOf: lib = libraryOf, currentId = currentLibraryId } = {}) {
  const current = currentId(state && state.settings);
  const chars = judgedChars(state);
  const sourceStarts = lineStarts('library-switch-source', tRef(ref('R-L06.sourceNote')));
  return LIBRARIES.map(def => {
    const keys = (lib(def.id) || { keys: [] }).keys || [];
    const keySet = new Set(keys);
    let recorded = 0;
    for (const c of chars) if (keySet.has(`base:${c}`)) recorded += 1;
    const total = keys.length;
    return {
      id: def.id,
      sourceStarts,
      name: libraryNameRef(def.id),
      desc: libraryDescRef(def.id),
      total,
      recorded,
      current: def.id === current,
      countLine: ref('R-L06.countLine', { n: total, m: recorded }),
    };
  });
}
