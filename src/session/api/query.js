// App API · 查字弹层与 S02（B3.6；计划 §3.4）。
// 形状见 ./index.js：OPS = { 'op 名': (args, ctx) => 回包 }。
//
//   view.query {mode, text, cur, selected} → {ok, view}：views/query.js querySheetModel（= 网页弹层渲染用的同一份模型；
//                    文案只给 copy 键 + 参数，原生用 ShiziCopy 渲染）
//   query.add {char}                加入自选的字（core/query withCustomAdded 的一次 commit；已在自选里不写）
//   query.pick {chars, from}        「练这个字」/「练这 N 个字」：跑网页弹层登记的回调（onPractice / onPick）；
//                    回调回 {ok:false} 时回 {ok:false}（原生就地三段式 R-H06）
//   query.detail {char}             「查看记录」：跑网页登记的回调（onDetail）
//   view.s02 {chars}                → {ok, view}：S02 的正文与三键（copy 键 + 参数）
//   s02.decide {action}             S02 的三个键：continue（接着写那组）/ endStart（结束那组开新的）/ cancel（取消）。
//                    endStart 是一次 commit（core/session-start.endOldAndStartPicked）；失败回 {ok:false}（原生留在框内三段式）
//
// 网页与原生走同一组回调（网页弹层登记 → 原生弹层经 op 调用）：ui/components/query/index.js 与 ui/screens/session/s02.js
// 打开弹层时经 setQueryActions / setS02Actions 登记（同一份登记点，网页路径 == API 路径）。

import { querySheetModel, deckPredicates, commitAdd } from '../views/query.js';
import { t } from '../../config/copy/index.js';

// ---------------------------------------------------------------- 排版提示（网页登记；原生按这些折行点换行）

// 网页的折行点（B3.6，同结果页 B2.7）：中文的断行与原生不同（网页按词典断行 + text-wrap: pretty 平衡），
// 页面用同一组 CSS 类量出每一行从第几个字开始，原生按这些位置换行。没有 DOM（node:test）时没有提示。
let queryLayout = null;

/**
 * 页面登记它的排版提示（measure：给一段字 → 折行点）；重复登记的键覆盖旧的，传 null 全部清掉。
 * @param {{s02Body?: function, cardAction?: function}|null} hooks
 */
export function setQueryLayout(hooks) {
  queryLayout = hooks && typeof hooks === 'object' ? { ...(queryLayout || {}), ...hooks } : null;
}

/** 一段字在某段排版里的折行点（没有页面登记 / 量不到 → null）。 */
function lineStarts(kind, text) {
  if (!queryLayout || typeof queryLayout[kind] !== 'function' || !text) return null;
  const starts = queryLayout[kind](text);
  return Array.isArray(starts) && starts.length ? starts : null;
}

// ---------------------------------------------------------------- 回调登记（网页弹层开的时候登记）

let queryActions = null;
let s02Actions = null;

/** 网页查字弹层登记它的动作（onPick / onPractice / onDetail / close）；传 null 取消。 */
export function setQueryActions(a) {
  queryActions = a && typeof a === 'object' ? a : null;
}

export function queryActionsRef() {
  return queryActions;
}

/** 网页 S02 登记它的动作（onContinue / onEndStart / onStarted）；传 null 取消。 */
export function setS02Actions(a) {
  s02Actions = a && typeof a === 'object' ? a : null;
}

export function s02ActionsRef() {
  return s02Actions;
}

// ---------------------------------------------------------------- 工具

function fail(kind, extra) {
  return { ok: false, error: { kind, ...(extra || {}) } };
}

/** 回调的结果（同步值或 Promise）是不是失败：{ok:false}（与网页 components/query/QuerySheet.js isFailure 同一份）。 */
async function isFailure(result) {
  let value = result;
  try {
    value = await result;
  } catch (error) {
    return true;
  }
  return !!(value && typeof value === 'object' && value.ok === false);
}

/** 「鲜」「境」→ 正文里的 {chars}（网页 ui/screens/session/s02.js quoteChars 同一份）。 */
export function quoteChars(chars) {
  return (chars || []).map(c => `「${c}」`).join('');
}

// ---------------------------------------------------------------- ops

export const OPS = Object.freeze({
  'view.query': (args, ctx) => {
    const a = args || {};
    const mode = a.mode === 'pick' ? 'pick' : 'lookup';
    const state = ctx.getStore().getState();
    const predicates = deckPredicates(state.settings);
    const view = querySheetModel({
      mode,
      text: typeof a.text === 'string' ? a.text : '',
      cur: typeof a.cur === 'string' ? a.cur : '',
      selected: Array.isArray(a.selected) ? a.selected : [],
      state,
      predicates,
      getInk: typeof ctx.getStore().getInk === 'function' ? (id => ctx.getStore().getInk(id)) : null,
      store: ctx.getStore(),
    });
    // 卡片次要键的折行点（网页量的；原生按这些位置换行）。
    if (view.card) {
      const addLines = lineStarts('cardAction', t(view.card.custom ? 'R-Q05.alreadyAdded' : 'R-Q05.btnAdd'));
      const detailLines = lineStarts('cardAction', t('R-Q05.viewRecords'));
      if (addLines) view.card.addLines = addLines;
      if (detailLines) view.card.detailLines = detailLines;
    }
    return { ok: true, view };
  },

  'query.add': (args, ctx) => {
    const a = args || {};
    const char = typeof a.char === 'string' ? a.char : '';
    if (!char) return fail('invalid');
    const r = commitAdd(ctx.getStore(), char);
    if (r && r.ok) return { ok: true };
    return fail(r && r.error && r.error.kind ? r.error.kind : 'generic');
  },

  'query.pick': async (args, ctx) => {
    const a = args || {};
    const chars = Array.isArray(a.chars) ? a.chars.filter(c => typeof c === 'string') : [];
    if (!chars.length) return fail('invalid');
    const acts = queryActions;
    let closed = false;
    // 网页弹层的 api.close()：网页版关弹层；原生版由登记方（ui/components/query/index.js）当场把原生查字屏出栈（与网页同一时序：
    // 先关弹层，再开 S02 / 写字页）。登记方没给 close 时，回包带 close，原生自己收起。
    const api = {
      mode: chars.length > 1 || a.from === 'bar' ? 'pick' : (acts && acts.mode) || 'lookup',
      close: () => {
        if (closed) return;
        closed = true;
        if (acts && typeof acts.close === 'function') acts.close();
      },
    };
    const cb = a.from === 'card' && acts && typeof acts.onPractice === 'function'
      ? () => acts.onPractice(chars[0], api)
      : (acts && typeof acts.onPick === 'function' ? () => acts.onPick(chars, api) : null);
    if (!cb) return fail('unavailable');
    if (await isFailure(cb())) return fail('generic');
    return { ok: true, close: closed && !(acts && typeof acts.close === 'function') };
  },

  'query.detail': async (args, ctx) => {
    const a = args || {};
    const char = typeof a.char === 'string' ? a.char : '';
    if (!char) return fail('invalid');
    const acts = queryActions;
    if (!acts || typeof acts.onDetail !== 'function') return fail('unavailable');
    if (await isFailure(acts.onDetail(char, { close: () => {} }))) return fail('generic');
    return { ok: true };
  },

  'view.s02': (args, ctx) => {
    const a = args || {};
    const chars = Array.isArray(a.chars) ? a.chars.filter(c => typeof c === 'string') : [];
    const bodyText = t('R-H05.body', { chars: quoteChars(chars) });
    const view = {
      chars,
      body: { key: 'R-H05.body', vars: { chars: quoteChars(chars) } },
      fail: { key: 'X-SESSION.s02SaveFailed', vars: {} },
      continue: { key: 'R-H05.continueOld', vars: {} },
      endStart: { key: 'R-H05.endOldStartNew', vars: {} },
      cancel: { key: 'R-H05.cancel', vars: {} },
      failCancel: { key: 'X-SESSION.s02Cancel', vars: {} },
      retry: { key: 'X-SESSION.s02Retry', vars: {} },
    };
    // 正文的折行点（网页量的；原生按这些位置换行）。
    const bodyLines = lineStarts('s02Body', bodyText);
    if (bodyLines) view.bodyLines = bodyLines;
    return { ok: true, view };
  },

  's02.decide': async (args, ctx) => {
    const a = args || {};
    const acts = s02Actions;
    if (!acts) return fail('unavailable');
    // 登记方给了 close（ui/screens/session/s02.js）：与网页同一时序，先关框（原生 S02 出栈）再开写字页；回包 close:false（已经关了）。
    // 没给时回包 close:true，原生自己收起。
    const selfClose = typeof acts.close === 'function';
    if (a.action === 'continue') {
      if (typeof acts.onContinue !== 'function') return fail('unavailable');
      if (selfClose) acts.close();
      acts.onContinue();
      return { ok: true, close: !selfClose };
    }
    if (a.action === 'cancel') {
      if (typeof acts.onCancel === 'function') acts.onCancel();
      return { ok: true, close: true };
    }
    if (a.action === 'endStart') {
      if (typeof acts.onEndStart !== 'function') return fail('unavailable');
      const r = await acts.onEndStart();
      if (!r || r.ok === false) return fail('generic'); // 留在框内三段式（R-G04）
      if (selfClose) acts.close();
      if (typeof acts.onStarted === 'function') acts.onStarted(r);
      return { ok: true, close: !selfClose };
    }
    return fail('invalid');
  },
});
