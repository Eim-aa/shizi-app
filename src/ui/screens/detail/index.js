// 单字详情（02 M3-6；04 R-D01–R-D10；决定-D18 / D21 / D23 / D24；03 P10b / P12 / P19；01 §3.2 / §3.5 / §4；
// 原型 ShiziScreen-第十稿交接版 L32–L61（detail / detailEmpty）、L128–L132（photo）、L389–L413（数据）；
// reference/J-proto-screen.md §2.3.3–§2.3.5、§2.3.15）。
//
// registerScreen('detail')，params {char}。进入：openDetail(char)（字库墙 / 清单行 / 查字卡片「查看记录」onDetail / 字帖格子）。
// 打开本页不写任何东西、不碰会话：B 没写完时打开详情不弹 S02、不改 sessions.B（S02 只在点「练这个字」时由 startPicked 弹）。
//
// 版式（自上而下；H1 / V2-03、T2-13、N2-10，03 P223 起没有凹面卡；第三轮 V3-04 / T3-11 / N3-09 去重）：页头（返回，标题空，原型如此）→ [词语反馈横幅，sticky] → 头图（「第一次 | 最近一次」两格本人墨，
//   只写过一次只有一格居中；没写过才是参考字形；写错的那一次日期后有朱点）+ 一行拼音（黑体）/ N 画（参考字形在写过时降为这一行末尾 44pt 的小格）+ 「词语」词块（36pt 小格，目标字位框）或「释义」+ 释义句 →
//   记录块（records.js；只列头图那两次之外的记录，没有「首次记录」）→ 字源行（R-D09）→ 列表行（actions.js）→ 底栏「练这个字」。
//   部首一行：运行时数据没有部首（O-data §6-10），不显示（报告登记）。
// 「练这个字」（R-D08）：一律走 session/index.js startPicked([字], {source:{view:'detail', char}})——旧 B 没写完时它弹 S02；
//   写完 / 结束这组后结果页「回到「{字}」」按页面栈返回本页（R-R06 / S05）。开组写入失败：底栏换成三段式。
// 撤销寿命（R-D06 / R-G05 / D24「离开这一页前可以撤销」）：移除自选的撤销底栏与换词横幅只活在本页；本页不再是最上层页面
//   （返回、切 tab、推入写字页 / 清单 / 旧记录页）即失效（本页上的确认框 / 放大弹层不算离开）。刷新同样失效（只在内存里）。
//
// 入口桩：
//   setDetailImageAction(fn)         M4-5 注册「把这个字做成图片」的去处 fn({char, cardKey, record})；没注册时这一行不显示（R-D04）。
//   setDetailListActions({wrong, forget})  写错过 / 快忘了行的去处；缺省为已注册的 'library-list' 页（M3-2，params {kind}）。
//
// 规则：所有写入只经 store.commit（actions.js）；文案只取 copy/；过渡值只读 policy.js。
//
// data-testid：detail-screen（data-char / data-count / data-list / data-custom / data-word-off）、detail-card、detail-ref、
//   detail-pinyin、detail-strokes、detail-word-label、detail-word（词块，data-word）、detail-word-tile（data-blank）、detail-gloss、
//   detail-practice、detail-practice-fail（+ -cancel / -retry）、detail-undo（撤销底栏外层，data-state）+ UndoBar 的 undo-bar /
//   undo-button；其余见 records.js / actions.js / photos.js。

import { html, useEffect, useState } from '../../../../vendor/ui.js';
import { registerScreen, getRouter, getScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button } from '../../components/Button.js';
import { Confirm } from '../../components/Confirm.js';
import { PracticeGlyph } from '../../components/PracticeGlyph.js';
import { UndoBar } from '../../components/UndoBar.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { getStore } from '../../../store/store.js';
import { now as envNow } from '../../../platform/env.js';
import { localDay } from '../../../core/dates.js';
import { isHan } from '../../../core/query.js';
import { RefMini } from '../write/compare.js';
import { useStrokeData } from '../write/hint-layer.js';
import { startPicked } from '../session/index.js';
import { isPracticable } from '../../../data/deck.js';
import { detailHero, detailModel, hasInkPoints, HeroPair, inkOf, RecordsBlock, SourceRow } from './records.js';
import {
  commitRemoveCustom, commitRestoreCustom, commitWordOff, commitWordOn, DetailRows, FailBlock, WordBanner,
} from './actions.js';
import { PHOTO_SCREEN } from './photos.js'; // 旧记录页自注册

export const DETAIL_SCREEN = 'detail';
export const LIST_SCREEN_NAME = 'library-list'; // M3-2 清单页（params {kind:'wrong'|'forget'}）
export const REMOVE_OVERLAY = 'detail-remove';
export const BANNER_UNDONE_MS = 2400;

injectStyles('detail', `
.sz-dhead{display:flex;flex-direction:column;gap:${T.s4}} /* 头部直接放在纸上：没有凹面卡（框中框），只留笺框一层（T2-13） */
.sz-dhead__row{display:flex;align-items:flex-start;gap:${T.s4};min-width:0}
.sz-dcard__info{flex:1;display:flex;flex-direction:column;gap:12px;min-width:0}
.sz-dcard__top{display:flex;align-items:baseline;gap:${T.s2};flex-wrap:wrap}
.sz-dcard__py{font-family:${T.hei};font-size:${T.fs17};line-height:${T.lh17s};font-weight:400;color:${T.ink2}} /* 拼音一律黑体（D33 / 设计说明 6） */
.sz-dcard__meta{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3}}
.sz-dcard__refsm{flex:none;width:44px} /* 参考字形降为 44pt 的小格，放在拼音那一行的末尾（T3-11：全 App 只有大 / 中 / 小三档格） */
.sz-dcard__ref{width:calc((100% - 12px) / 2)}
.sz-dcard__wordbox{display:flex;flex-direction:column;gap:8px;min-width:0;container-type:inline-size}
.sz-dcard__label{font-size:${T.fs13};color:${T.ink2}}
.sz-dcard__tiles{display:grid;grid-template-columns:repeat(var(--n, 2),minmax(0,1fr));box-sizing:border-box;
  width:min(100%, calc(36px * var(--n, 2) + 2px));border:${T.frameW} solid ${T.frame};text-align:center;color:${T.ink1};${TEX}}
/* 词语小字帖里的字是轮廓（P1-E2）：格 36 × 36（小一档，T3-11），字方框 28，格更窄时随格收窄 */
.sz-dcard__tile{position:relative;min-width:0;height:36px}
.sz-dcard__tile>.sz-pg{position:absolute;left:50%;top:50%;width:min(28px, 90%);height:auto;aspect-ratio:1/1;transform:translate(-50%,-50%)}
.sz-dcard__tile + .sz-dcard__tile{border-left:${T.frameW} solid ${T.frame}}
.sz-dcard__tile[data-blank="true"]{box-shadow:inset 0 0 0 ${T.targetW} ${T.ink1}}
.sz-dcard__gloss{font-family:${T.kai};font-size:${T.fs17};line-height:${T.lh17};color:${T.ink1}}
.sz-detail__undo{position:relative;margin:0 -8px}
.sz-detail__undo .sz-undobar{position:relative;left:auto;right:auto;bottom:auto}
`);

// ---------------------------------------------------------------- 入口桩与打开

const hooks = { image: null, list: { wrong: null, forget: null } };

/** M4-5：「把这个字做成图片」的去处 fn({char, cardKey, record})；null 取消（R-D04）。 */
export function setDetailImageAction(fn) {
  hooks.image = typeof fn === 'function' ? fn : null;
}

/** 写错过 / 快忘了行的去处（缺省为已注册的 'library-list' 页）。 */
export function setDetailListActions(next = {}) {
  if ('wrong' in next) hooks.list.wrong = typeof next.wrong === 'function' ? next.wrong : null;
  if ('forget' in next) hooks.list.forget = typeof next.forget === 'function' ? next.forget : null;
}

function listOpener(kind) {
  const fn = hooks.list[kind];
  if (fn) return fn;
  if (getScreen(LIST_SCREEN_NAME)) return k => nav.push(LIST_SCREEN_NAME, { kind: k });
  return null;
}

/**
 * 打开单字详情（查字组件 onDetail(char, api) 可直接传它）。栈顶已是同一个字的详情时不再叠一层。
 * @returns {boolean} 是否推入
 */
export function openDetail(char) {
  if (!isHan(char)) return false;
  const router = getRouter();
  const snap = router ? router.getState() : null;
  const top = snap ? snap.top : null;
  if (snap && snap.depth > 0 && !snap.topIsOverlay && top && top.n === DETAIL_SCREEN && top.p && top.p.char === char) return false;
  nav.push(DETAIL_SCREEN, { char });
  return true;
}

// ---------------------------------------------------------------- hooks

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

function useStoreState() {
  const [state, setState] = useState(() => {
    const st = storeOrNull();
    return st ? st.getState() : null;
  });
  useEffect(() => {
    const st = storeOrNull();
    if (!st) return undefined;
    setState(st.getState());
    return st.subscribe(next => setState(next));
  }, []);
  return state;
}

/** 本页不再是最上层页面时调用 onLeave（撤销寿命「离开这一页」；遮罩不算）。 */
function useLeave(entryId, onLeave) {
  useEffect(() => {
    const router = getRouter();
    if (!router || !entryId) return undefined;
    return router.subscribe(snap => {
      if (!snap.top || snap.top.id !== entryId) onLeave();
    });
  }, [entryId]);
}

// ---------------------------------------------------------------- 字卡

function CharCard({ model, strokeData, store }) {
  const { word } = model;
  const hero = detailHero(model);
  const ref = html`<${RefMini} char=${model.char} strokeData=${strokeData} testid="detail-ref" label=${t('R-W09.labelReference')} />`;
  return html`<div class="sz-dhead" data-testid="detail-card">
    ${hero.kind === 'ink'
      ? html`<${HeroPair} hero=${hero} store=${store} />`
      : html`<div class="sz-dcard__ref">${ref}</div>`}
    <div class="sz-dhead__row">
      <div class="sz-dcard__info">
        <div class="sz-dcard__top">
          ${model.pinyin ? html`<span class="sz-dcard__py" data-testid="detail-pinyin">${model.pinyin}</span>` : null}
          ${model.strokes ? html`<span class="sz-dcard__meta" data-testid="detail-strokes">${t('X-DETAIL.strokes', { n: model.strokes })}</span>` : null}
        </div>
        ${model.card ? html`<div class="sz-dcard__wordbox">
          <span class="sz-dcard__label" data-testid="detail-word-label">${t(word.hasWord ? 'X-DETAIL.wordLabel' : 'X-DETAIL.glossLabel')}</span>
          ${word.hasWord
            ? html`<div class="sz-dcard__tiles" lang="zh-CN" role="img" aria-label=${model.card.word} data-testid="detail-word"
                data-word=${model.card.word} style=${`--n:${word.tiles.length}`}>${word.tiles.map((tile, i) => html`<span key=${i} class="sz-dcard__tile" aria-hidden="true"
                  data-testid="detail-word-tile" data-blank=${tile.blank ? 'true' : 'false'}><${PracticeGlyph} char=${tile.ch} face=${0.8} /></span>`)}</div>`
            : html`<span class="sz-dcard__gloss" data-testid="detail-gloss">${word.gloss}</span>`}
        </div>` : null}
      </div>
      ${hero.kind === 'ink' ? html`<div class="sz-dcard__refsm">${ref}</div>` : null}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- 页面

function DetailScreen({ params, entry }) {
  const char = params && typeof params.char === 'string' ? params.char : '';
  const state = useStoreState();
  const store = storeOrNull();
  const today = localDay(envNow());
  const model = detailModel(state, char, { today, hasInk: record => hasInkPoints(inkOf(store, record)) });
  // 题库外的字（如 D50 ① 因来源授权移除的字、迁移来的旧记录）没有 data/<字>.json：不发请求，参考字直接用楷体回退（与 components/work.js 同一取舍）。
  const strokeData = useStrokeData(isPracticable(`base:${char}`) ? char : '');

  const [undo, setUndo] = useState(null); // {removed, state:'on'|'failed'|'done'}
  const [banner, setBanner] = useState(null); // {word, cardKey, state:'on'|'failed'|'undone'}
  const [swapFailed, setSwapFailed] = useState(false);
  const [practiceFailed, setPracticeFailed] = useState(false);

  useLeave(entry && entry.id, () => {
    setUndo(null);
    setBanner(null);
    setSwapFailed(false);
    setPracticeFailed(false);
  });

  useEffect(() => {
    if (!banner || banner.state !== 'undone') return undefined;
    const timer = setTimeout(() => setBanner(b => (b === banner ? null : b)), BANNER_UNDONE_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  // ---- 换掉这个词语（R-D05）
  const swap = () => {
    const st = storeOrNull();
    const word = model.originalWord;
    const cardKey = model.cardKey;
    const r = st ? commitWordOff(st, cardKey) : { ok: false };
    if (r.ok) {
      setSwapFailed(false);
      setBanner({ word, cardKey, state: 'on' });
      return;
    }
    setSwapFailed(true);
  };
  const undoWord = () => {
    const b = banner;
    if (!b || b.state === 'undone') return;
    const st = storeOrNull();
    const r = st ? commitWordOn(st, b.cardKey) : { ok: false };
    setBanner({ ...b, state: r.ok ? 'undone' : 'failed' });
  };

  // ---- 从自选的字移除（R-D06）
  const openRemove = () => {
    let id = null;
    const attempt = () => {
      const st = storeOrNull();
      const r = st ? commitRemoveCustom(st, char) : { ok: false };
      if (r.ok) {
        nav.closeOverlay(id);
        if (r.removed) setUndo({ removed: r.removed, state: 'on' });
        return;
      }
      // R-G04 三段式：留在确认框
      nav.updateOverlay(id, { body: t('X-DETAIL.saveFailed'), cancelLabel: t('X-DETAIL.cancel'), confirmLabel: t('X-DETAIL.retry') });
    };
    id = nav.openOverlay(Confirm, {
      body: t('R-D06.confirmBody', { char }),
      cancelLabel: t('R-D06.confirmCancel'),
      confirmLabel: t('R-D06.confirmRemove'),
      onConfirm: attempt,
      testid: 'detail-remove-confirm',
    }, { name: REMOVE_OVERLAY });
  };
  const undoRemove = () => {
    const u = undo;
    if (!u || u.state === 'done') return;
    const st = storeOrNull();
    const r = st ? commitRestoreCustom(st, u.removed) : { ok: false };
    setUndo({ ...u, state: r.ok ? 'done' : 'failed' });
  };

  // ---- 练这个字（R-D08）
  const practice = () => {
    const r = startPicked([char], { source: { view: DETAIL_SCREEN, char } });
    setPracticeFailed(!!(r && r.ok === false));
  };

  const onList = model.list ? listOpener(model.list) : null;
  const main = practiceFailed
    ? html`<${FailBlock} testid="detail-practice-fail" note=${t('X-DETAIL.saveFailed')} onCancel=${() => setPracticeFailed(false)}
        onRetry=${practice} />`
    : html`<${Button} variant="primary" data-testid="detail-practice" disabled=${!model.practicable}
        onClick=${practice}>${t('R-D08.btnPractice')}</${Button}>`;
  // 边改 Z03（M6-6）：撤销底栏放在页面底栏区、「练这个字」上方（与备份页 R-B08 / Z04 同法），正文在它上方滚动——
  // 紧凑版里「已撤销」不再盖住「从自选的字移除」的副标题，也不靠自动上滚让位。
  const undoBlock = undo ? html`<div class="sz-detail__undo" data-testid="detail-undo" data-state=${undo.state}>
      <${UndoBar}
        line1=${undo.state === 'failed' ? t('X-DETAIL.saveFailed') : t('R-D06.undoL1', { char })}
        line2=${undo.state === 'failed' ? t('X-DETAIL.undoFailedL2') : t('R-D06.undoL2')}
        done=${undo.state === 'done'} onUndo=${undoRemove} onDoneEnd=${() => setUndo(null)} />
    </div>` : null;
  const footer = undoBlock ? [undoBlock, main] : main;

  return html`<div class="sz-detail" style=${{ height: '100%' }} data-testid="detail-screen" data-char=${char}
    data-count=${model.count} data-list=${model.list || ''} data-custom=${model.custom ? 'true' : 'false'}
    data-word-off=${model.wordOff ? 'true' : 'false'}>
    <${Page} title="" footer=${footer}>
      <${WordBanner} banner=${banner} onUndo=${undoWord} />
      <${CharCard} model=${model} strokeData=${strokeData} store=${store} />
      <${RecordsBlock} model=${model} store=${store} />
      <${SourceRow} char=${char} />
      <${DetailRows} model=${model} onList=${onList} onImage=${hooks.image} swapFailed=${swapFailed}
        onLegacy=${() => nav.push(PHOTO_SCREEN, { char })} onSwap=${swap} onSwapCancel=${() => setSwapFailed(false)}
        onRemove=${openRemove} />
    </${Page}>
  </div>`;
}

registerScreen(DETAIL_SCREEN, DetailScreen, { label: '' });
