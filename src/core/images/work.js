// 作品成员（纯函数，无 DOM；阶段 1 P1-E7；交接 §4.2 / §5.1 / §6.6；D31 / D46 ⑥ ⑩ / D47）。
//
// 结果页上的作品、分享图、「放进去」共用同一套成员规则：
//   默认      = 写对 ∪（看过答案 ∧ 有看后自写的本人墨）               state 'in'；看后自写的格下标「看后写的」（App 内）
//   可手动加入 = 写错 ∧ 有墨                                        state 'addable'（作品下一行「放进去」）→ 加入后 'added'（带朱点，D46 ⑥）
//   不可加入   = 无墨：写对 / 写错但没留墨迹（'noInk'）、看过答案没写（'seen'）、跳过（'skipped'）、纸上（'paper'）
// 顺序 = 组内顺序（items 顺序）；墨取本次该字最后一次本人墨（D11 / D42，由调用方的 hasInk 判断「这条记录有没有墨」）。
// 「纸上」：记录 source === 'paper'（core/records.js isPaperRecord；P1-E8 字段，P1-E78 接入）；纸上记录 ink = null，永远不进作品、不可「放进去」，state 'paper'。
// 「放进去」的状态存在本组会话上（session.added = recordId[]，经 store.commit），刷新后仍在（core/schema.js sessionFields.added）。

import { isPaperRecord } from '../records.js';

// 判定在 core/records.js（P1-E8 字段、P1-E78 接入）；这里再导出，保持 images 内部与单测的引用不变。
export { isPaperRecord };

/** 本组里用户「放进去」的记录 id 集合。 */
export function addedOf(session) {
  return new Set(session && Array.isArray(session.added) ? session.added.filter(id => typeof id === 'string') : []);
}

/** 加入 / 拿出一条记录后的 added 数组（不改入参；顺序按首次加入先后）。 */
export function toggleAdded(session, recordId, on) {
  const cur = session && Array.isArray(session.added) ? session.added.filter(id => typeof id === 'string') : [];
  const has = cur.includes(recordId);
  const want = on === undefined ? !has : !!on;
  if (want === has) return cur;
  return want ? [...cur, recordId] : cur.filter(id => id !== recordId);
}

/**
 * 一组的作品成员。
 * @param {object} o
 * @param {Array<{cardKey:string, recordId?:string, kind:'judged'|'answer-seen'|'skipped'}>} o.items  组内顺序
 * @param {Map<string,object>|((id:string)=>object|null)} o.records  记录 id → 记录
 * @param {(record:object)=>boolean} o.hasInk  这条记录有没有本人墨
 * @param {Set<string>|string[]} [o.added]  已「放进去」的记录 id
 * @param {(cardKey:string)=>string} [o.charOf]
 * @returns {{entries:Array, cells:Array, rows:Array, addable:Array, empty:boolean}}
 *   entry = {index, cardKey, recordId, record, char, kind, judgment, state, hasInk, paper, tag, dot}
 */
export function buildWork({ items, records, hasInk, added = [], charOf = key => String(key).split(':')[1] || '' }) {
  const addedIds = added instanceof Set ? added : new Set(added);
  const lookup = typeof records === 'function' ? records : id => (records && typeof records.get === 'function' ? records.get(id) : null) || null;
  const entries = (items || []).map((item, index) => {
    const record = item.recordId ? lookup(item.recordId) : null;
    const kind = record ? record.kind : item.kind;
    const char = record && record.char ? record.char : charOf(item.cardKey);
    const judgment = kind === 'judged' && record ? record.judgment : null;
    const paper = isPaperRecord(record);
    let ink = false;
    if (record && !paper && kind !== 'skipped') {
      try {
        ink = !!hasInk(record);
      } catch (error) {
        ink = false;
      }
    }
    let state;
    if (kind === 'skipped') state = 'skipped';
    else if (paper) state = 'paper';
    else if (kind === 'answer-seen') state = ink ? 'in' : 'seen';
    else if (judgment === 'wrong') state = ink ? (addedIds.has(record.id) ? 'added' : 'addable') : 'noInk';
    else state = ink ? 'in' : 'noInk';
    return {
      index,
      cardKey: item.cardKey,
      recordId: record ? record.id : item.recordId || null,
      record,
      char,
      kind,
      judgment,
      state,
      hasInk: ink,
      paper,
      tag: kind === 'answer-seen' && ink ? 'afterSeen' : '',
      dot: state === 'added',
    };
  });
  const cells = entries.filter(e => e.state === 'in' || e.state === 'added');
  const rows = entries.filter(e => e.state !== 'in');
  const addable = entries.filter(e => e.state === 'addable' || e.state === 'added');
  return { entries, cells, rows, addable, empty: cells.length === 0 };
}
