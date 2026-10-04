// 换库（02 M3-5；04 R-L06；01 §3 settings.library、§4 写入点「换库 · 就地重试」；03 P73；原型 ShiziScreen L186–L191、
// 逻辑 L459–L465 / L485–L489 / 可点原型模板 L702–L705，reference/J-proto-screen.md §2.3.23–2.3.24）。
//
// 页面 'library-switch'（「我的 › 设置 › 练习 › 练习范围」推入——D49 ④ 起字库页不再有入口；设置页 settings.js 按屏名 push，openLibrarySwitch() 同一去处）：
//   页头「更换字库」+ 返回；四行（core/cards.js LIBRARIES 顺序）：库名（当前 500）/ 一句说明 / 数量行
//   「可以练 {n} 个字 · 有记录 {m} 个」（n = 题库里属于该库的卡数，从数据算：3500 / 2976 / 818 / 2500；
//   m = 该库里有 judged 记录的字数，D23 口径只算写对 / 写错，按记录算，不用原型写死值）/ 右侧「正在用」或「›」；
//   数量行两段各自不折断（「折行整段换行」）；底注 R-L06.sourceNote。
//   点当前库 → 返回（原型 lib:<当前库> 只关弹层）；点别的库 → 居中确认框。
// 确认框（S02 同一版式，自带 testid）：标题「换成「{库名}」？」+ 正文 R-L06.confirmBody + 取消 / 换成这个库。
//   换成这个库 → 一次 store.commit 只改 settings.library（records / sched / custom / wordOff / sessions 都不碰——
//   已开的组照旧，只影响之后选新字的来源，session-start 读 settings.library）。
//   失败 → 就地重试（01 §4「换库 · 就地重试」、R-G04 三段式）：确认框留着，正文换成 R-L06.saveFailed，
//   两键「先不换」（关框，仍是原来的库）/「再试一次」（同一 commit）。
//   成功 → 关框、返回上一页（设置页），轻提示「已换成「{库名}」。」（R-L06「换完轻提示」边开发边改，字样待文案 P55）。
//
// data-testid：libswitch-screen（页面；入口是设置页的 settings-library 行）、libswitch-list（data-current）、libswitch-row（data-lib / data-current，每行一个 button）、
//   libswitch-row-name / -desc / -count / -mark、libswitch-source、
//   libswitch-confirm（data-state=ask|failed / data-lib）、libswitch-confirm-title / -body、
//   libswitch-cancel、libswitch-ok、libswitch-stay、libswitch-retry。

import { html, useEffect, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, nav } from '../../router.js';
import { setNoneActions } from '../session/none.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { useDialogFocus } from '../../components/Sheet.js';
import '../../components/Confirm.js'; // .sz-overlay / .sz-confirm 样式
import { showToast } from '../../components/Toast.js';
import { injectStyles, T } from '../../components/styles.js';
import { getStore } from '../../../store/store.js';
import { LIBRARIES } from '../../../core/cards.js';
import { flattenRecords } from '../../../core/query.js';
import { isJudged } from '../../../core/records.js';
import { currentLibraryId, libraryOf } from '../../../data/deck.js';
import { t } from '../../../config/copy/index.js';

export const LIBRARY_SWITCH_SCREEN = 'library-switch';
export const LIBRARY_CONFIRM_OVERLAY = 'library-confirm';
export const SWITCH_LABEL = 'library:switch';

// ---------------------------------------------------------------- 纯函数（test/ui/library-switch.test.mjs）

/** 库名 / 一句说明（copy R-L06.lib.<id>.*）。 */
export function libraryName(id) {
  return t(`R-L06.lib.${id}.name`);
}

export function libraryDesc(id) {
  return t(`R-L06.lib.${id}.desc`);
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
 * @returns {{id, name, desc, total, recorded, current, countLine}[]}
 */
export function libraryRows(state, { libraryOf: lib = libraryOf, currentId = currentLibraryId } = {}) {
  const current = currentId(state && state.settings);
  const chars = judgedChars(state);
  return LIBRARIES.map(def => {
    const keys = (lib(def.id) || { keys: [] }).keys || [];
    const keySet = new Set(keys);
    let recorded = 0;
    for (const c of chars) if (keySet.has(`base:${c}`)) recorded += 1;
    const total = keys.length;
    return {
      id: def.id,
      name: libraryName(def.id),
      desc: libraryDesc(def.id),
      total,
      recorded,
      current: def.id === current,
      countLine: t('R-L06.countLine', { n: total, m: recorded }),
    };
  });
}

/** 数量行按「 · 」拆成整段（每段不折断，折行时整段换行）。 */
export function countSegments(line) {
  return String(line).split(' · ');
}

/**
 * 换库：一次 commit 只改 settings.library（其余 settings 字段保留）。已是这个库时不写。
 * @returns store.commit 的结果（{ok, keys} | {ok:false, error}）
 */
export function commitLibrary(store, id) {
  return store.commit(SWITCH_LABEL, draft => {
    const settings = draft.settings && typeof draft.settings === 'object' ? draft.settings : {};
    if (settings.library === id) return;
    draft.settings = { ...settings, library: id };
  });
}

// ---------------------------------------------------------------- 样式

injectStyles('library-switch', `
.sz-libsw__list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}
.sz-libsw__row{width:100%;min-height:62px;padding:10px 0;display:flex;align-items:center;gap:12px;text-align:left;
  color:${T.ink1};border-bottom:.5px solid ${T.line}}
.sz-libsw__item:last-child .sz-libsw__row{border-bottom:0}
.sz-libsw__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.sz-libsw__name{font-size:${T.fs17};line-height:${T.lh17};font-weight:400;}
.sz-libsw__row[data-current="true"] .sz-libsw__name{font-weight:500}
.sz-libsw__desc{font-size:${T.fs13};line-height:${T.lh13};color:${T.ink2}}
.sz-libsw__count{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2}}
.sz-libsw__seg{white-space:nowrap}
.sz-libsw__mark{flex:none;font-size:${T.fs15};color:${T.ink3}}
.sz-libsw__row[data-current="true"] .sz-libsw__mark{font-size:${T.fs13};color:${T.ink1}}
.sz-libsw__source{margin:0;font-size:${T.fs13};line-height:${T.lh13};color:${T.ink3}}
`);

// ---------------------------------------------------------------- 状态订阅

function readState() {
  try {
    return getStore().getState();
  } catch (error) {
    return null;
  }
}

function useStoreState() {
  const [state, setState] = useState(readState);
  useEffect(() => {
    let store = null;
    try {
      store = getStore();
    } catch (error) {
      return undefined;
    }
    setState(store.getState());
    return store.subscribe(next => setState(next));
  }, []);
  return state;
}

// ---------------------------------------------------------------- 确认框

let dialogSeq = 0;

/**
 * 确认框视图（纯函数，无 hooks；test/ui/library-switch.test.mjs 直接调用）。
 * @param {object} props
 * @param {string} props.id           目标库 id
 * @param {boolean} [props.failed]    保存失败（就地重试态）
 * @param {() => void} props.onConfirm   换成这个库 / 再试一次
 * @param {() => void} [props.close]     取消 / 先不换 / 点遮罩
 * @param {object} [props.panelRef]
 * @param {{title:string, body:string}} [props.ids]
 */
export function LibraryConfirmView({ id, failed = false, onConfirm, close, panelRef = null, ids = { title: 'sz-libsw-title', body: 'sz-libsw-body' } }) {
  const cancel = () => close && close();
  const body = failed ? t('R-L06.saveFailed') : t('R-L06.confirmBody').join('\n');
  const actions = failed
    ? html`<${Button} variant="secondary" data-testid="libswitch-stay" onClick=${cancel}>${t('R-L06.cancel')}</${Button}>
        <${Button} variant="primary" data-testid="libswitch-retry" onClick=${() => onConfirm && onConfirm()}>${t('R-L06.retry')}</${Button}>`
    : html`<${Button} variant="secondary" data-testid="libswitch-cancel" onClick=${cancel}>${t('X-LIBSWITCH.confirmCancel')}</${Button}>
        <${Button} variant="primary" data-testid="libswitch-ok" onClick=${() => onConfirm && onConfirm()}>${t('X-LIBSWITCH.confirmOk')}</${Button}>`;
  return html`<div class="sz-overlay" data-overlay="confirm">
    <div class="sz-scrim" aria-hidden="true" onClick=${cancel}></div>
    <div class="sz-confirm" role="alertdialog" aria-modal="true" tabindex="-1" ref=${panelRef} data-testid="libswitch-confirm"
      data-state=${failed ? 'failed' : 'ask'} data-lib=${id} aria-labelledby=${ids.title} aria-describedby=${ids.body}>
      <h2 class="sz-confirm__title" id=${ids.title} data-testid="libswitch-confirm-title">${t('X-LIBSWITCH.confirmTitle', { library: libraryName(id) })}</h2>
      <p class="sz-confirm__body" id=${ids.body} data-testid="libswitch-confirm-body">${body}</p>
      <div class="sz-confirm__actions">${actions}</div>
    </div>
  </div>`;
}

/** 换库确认框（overlay 组件；root 注入 close / active）。不预选任何按钮（焦点落在对话框本身）。 */
export function LibraryConfirm({ id, failed = false, onConfirm, close, active = true }) {
  const panelRef = useRef(null);
  const idsRef = useRef(null);
  if (!idsRef.current) {
    dialogSeq += 1;
    idsRef.current = { title: `sz-libsw-title-${dialogSeq}`, body: `sz-libsw-body-${dialogSeq}` };
  }
  useDialogFocus(panelRef, active);
  return LibraryConfirmView({ id, failed, onConfirm, close, panelRef, ids: idsRef.current });
}

/**
 * 打开换库确认框。成功：关框 → 返回上一页 → 轻提示；失败：确认框换成就地重试态。
 * @param {string} id
 * @param {object} [o]
 * @param {() => object} [o.getStore]   测试注入
 * @returns overlay id
 */
export function openLibraryConfirm(id, { getStore: storeOf = getStore } = {}) {
  let overlayId = null;
  let done = false;
  const confirm = () => {
    if (done) return;
    let result;
    try {
      result = commitLibrary(storeOf(), id);
    } catch (error) {
      result = { ok: false, error: { kind: 'unknown', reason: error && error.message ? error.message : String(error) } };
    }
    if (result && result.ok) {
      done = true;
      nav.closeOverlay(overlayId);
      nav.back();
      showToast(t('X-LIBSWITCH.switchedToast', { library: libraryName(id) }));
      return;
    }
    nav.updateOverlay(overlayId, { failed: true });
  };
  overlayId = nav.openOverlay(LibraryConfirm, { id, failed: false, onConfirm: confirm }, { name: LIBRARY_CONFIRM_OVERLAY });
  return overlayId;
}

// ---------------------------------------------------------------- 页面

function Row({ row, onPick }) {
  const segs = countSegments(row.countLine);
  return html`<li class="sz-libsw__item">
    <${Button} variant="plain" class="sz-libsw__row" data-testid="libswitch-row" data-lib=${row.id}
      data-current=${row.current ? 'true' : 'false'} aria-current=${row.current ? 'true' : undefined}
      onClick=${() => onPick(row)}>
      <span class="sz-libsw__main">
        <span class="sz-libsw__name" data-testid="libswitch-row-name">${row.name}</span>
        <span class="sz-libsw__desc" data-testid="libswitch-row-desc">${row.desc}</span>
        <span class="sz-libsw__count" data-testid="libswitch-row-count" data-total=${row.total} data-recorded=${row.recorded}>${
          segs.map((s, i) => html`${i ? ' · ' : ''}<span class="sz-libsw__seg">${s}</span>`)}</span>
      </span>
      ${row.current
        ? html`<span class="sz-libsw__mark" data-testid="libswitch-row-mark">${t('X-LIBSWITCH.current')}</span>`
        : html`<span class="sz-libsw__mark" data-testid="libswitch-row-mark" aria-hidden="true">${t('X-LIBSWITCH.more')}</span>`}
    </${Button}>
  </li>`;
}

function LibrarySwitchScreen() {
  const state = useStoreState();
  const rows = libraryRows(state);
  const current = rows.find(r => r.current);
  const pick = row => {
    if (row.current) {
      nav.back();
      return;
    }
    openLibraryConfirm(row.id);
  };
  return html`<${Page} title=${t('X-LIBSWITCH.title')} testid="libswitch-screen">
    <ul class="sz-libsw__list" data-testid="libswitch-list" data-current=${current ? current.id : ''}>
      ${rows.map(row => html`<${Row} key=${row.id} row=${row} onPick=${pick} />`)}
    </ul>
    <p class="sz-libsw__source" data-testid="libswitch-source">${t('R-L06.sourceNote')}</p>
  </${Page}>`;
}

registerScreen(LIBRARY_SWITCH_SCREEN, LibrarySwitchScreen, { label: t('X-LIBSWITCH.title') });

/** 推入换库页（字库页「更换字库 ›」、M3-1 调用）。 */
export function openLibrarySwitch() {
  nav.push(LIBRARY_SWITCH_SCREEN, {});
}

// 「现在没有要写的字」页（字库写完时）的主按钮「更换字库」推入本页（P83 / 原型 noChars → libSwitch）。
setNoneActions({ libSwitch: () => openLibrarySwitch() });
