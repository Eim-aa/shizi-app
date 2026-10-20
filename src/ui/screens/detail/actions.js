// 单字详情 · 动作（02 M3-6；04 R-D01 / R-D02 / R-D04 / R-D05 / R-D06 / R-D10；决定-D21 / D24；01 §3.5 / §4 写入点表；
// 原型 ShiziScreen-第十稿交接版 L47（列表行）、可点原型模板 L100–L112 / L648–L651 / L741 / L934（词语反馈横幅、移除与撤销条））。
//
// 写入（一律 store.commit，失败不发布，D07）：
//   commitWordOff(store, cardKey)          「换掉这个词语」：wordOff[cardKey] = now（01 §3.5）。写字页题面随之改只按拼音写
//                                          （data/deck.js withWordOff，write/prompt.js 读同一张表）。
//   commitWordOn(store, cardKey)           横幅「撤销」：删掉 wordOff[cardKey]。
//   commitRemoveCustom(store, char)        「从自选的字移除」：从 custom.added 删掉这个字；记录不动（R-D06）。
//                                          返回 {ok, removed:{entry, index}}（撤销用：原来的 {char, at} 与位置）。
//   commitRestoreCustom(store, removed)    撤销：按原来的位置放回原来的 {char, at}（已在里面时不写）。
// 失败表现（01 §4：加入自选 / 移除撤销、wordOff → 三段式 C125）：
//   换掉这个词语失败：行下方三段式（说明 + 先不保存 / 再试一次）；横幅撤销失败：横幅换成说明句，「撤销」保留可再点。
//   移除失败：确认框换成说明句 +［先不保存 / 再试一次］，不关；撤销失败：底栏第一行换说明句、第二行「可以再点一次撤销」。
//
// 列表行（原型顺序）：[写错过 / 快忘了 → 清单]、下次练习（P12）、[做成图片（M4-5 注册后才显示）]、[旧版本的记录（R-D10）]、
//   [换掉这个词语]、[从自选的字移除]。
//
// data-testid：detail-add（加入自选，D66 ⑮；失败 detail-add-fail + -cancel / -retry）、detail-rows、detail-list-row（data-list=wrong|forget）、detail-list-dot、detail-next、detail-image
//   （data-state=ok|noInk|noRecord）、detail-image-note、detail-legacy、detail-swap、detail-swap-fail（+ -cancel / -retry）、
//   detail-remove（一点即移除，没有确认框）、detail-remove-fail（+ -cancel / -retry）、detail-word-banner（换词的撤销条，data-state=on|failed|undone，里面是通用的 undo-bar / undo-button）。

import { html } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { FailBlock as SharedFailBlock } from '../../components/FailBlock.js';
import { Chevron } from '../../components/Chevron.js';
import { injectStyles, T } from '../../components/styles.js';
import { t, tInk } from '../../../config/copy/index.js';
import { commitAdd } from '../../components/query/QuerySheet.js';
import { dayText } from './records.js';

export const LABELS = Object.freeze({
  wordOff: 'detail:word-off',
  wordOn: 'detail:word-off-undo',
  remove: 'detail:custom-remove',
  restore: 'detail:custom-restore',
});

injectStyles('detail-actions', `
.sz-drows{display:flex;flex-direction:column;border-top:${T.hair} solid ${T.line}}
.sz-drow{box-sizing:border-box;width:100%;min-height:52px;padding:${T.s3} 0;display:flex;align-items:center;justify-content:space-between;
  gap:${T.s3};border:0;border-bottom:${T.hair} solid ${T.line};background:transparent;color:inherit;font:inherit;text-align:left}
button.sz-drow{cursor:pointer}
button.sz-drow:focus-visible{outline:2px solid ${T.ink1};outline-offset:2px}
.sz-drow--tall{min-height:60px}
.sz-drow__main{display:flex;flex-direction:column;gap:3px;min-width:0}
.sz-drow__title{display:flex;align-items:center;gap:${T.s2};font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink1}}
.sz-drow__title--off{color:${T.ink3}}
.sz-drow__sub{font-size:${T.fs15};line-height:${T.lh15};color:${T.ink3};text-wrap:pretty}
.sz-drow__sub--small{font-size:${T.fs13};color:${T.ink3}}
.sz-drow__value{flex:none;font-size:${T.fs15};color:${T.ink3}}
.sz-dfail{display:flex;flex-direction:column;gap:${T.s3};padding:${T.s3} 0;border-bottom:1px solid ${T.line}}
`);

// ---------------------------------------------------------------- 写入

/** 「换掉这个词语」：wordOff[cardKey] = now。已换掉时不写。 */
export function commitWordOff(store, cardKey) {
  return store.commit(LABELS.wordOff, (draft, ctx) => {
    const cur = draft.wordOff && typeof draft.wordOff === 'object' ? draft.wordOff : {};
    if (Object.prototype.hasOwnProperty.call(cur, cardKey)) return;
    draft.wordOff = { ...cur, [cardKey]: ctx.now };
  });
}

/** 撤销「换掉这个词语」：删掉 wordOff[cardKey]。不在里面时不写。 */
export function commitWordOn(store, cardKey) {
  return store.commit(LABELS.wordOn, draft => {
    const cur = draft.wordOff && typeof draft.wordOff === 'object' ? draft.wordOff : null;
    if (!cur || !Object.prototype.hasOwnProperty.call(cur, cardKey)) return;
    const next = { ...cur };
    delete next[cardKey];
    draft.wordOff = next;
  });
}

/** 「从自选的字移除」：custom.added 删掉这个字（记录不动，D21 / R-D06）。返回 commit 结果 + removed。 */
export function commitRemoveCustom(store, char) {
  let removed = null;
  const result = store.commit(LABELS.remove, draft => {
    const custom = draft.custom && typeof draft.custom === 'object' ? draft.custom : null;
    const added = custom && Array.isArray(custom.added) ? custom.added : [];
    const index = added.findIndex(e => e && e.char === char);
    if (index < 0) return;
    removed = { entry: { ...added[index] }, index };
    draft.custom = { ...custom, added: added.filter((_, i) => i !== index) };
  });
  return result.ok ? { ...result, removed } : result;
}

/** 撤销移除：把原来的 {char, at} 放回原来的位置（已在里面时不写）。 */
export function commitRestoreCustom(store, removed) {
  return store.commit(LABELS.restore, draft => {
    if (!removed || !removed.entry) return;
    const custom = draft.custom && typeof draft.custom === 'object' ? draft.custom : {};
    const added = Array.isArray(custom.added) ? custom.added : [];
    if (added.some(e => e && e.char === removed.entry.char)) return;
    const at = Math.max(0, Math.min(Number.isInteger(removed.index) ? removed.index : added.length, added.length));
    draft.custom = { ...custom, added: [...added.slice(0, at), { ...removed.entry }, ...added.slice(at)] };
  });
}

/** 「加入自选」（D66 ⑮）：与查字卡同一个函数（QuerySheet.commitAdd：已在自选里不写，经 store.commit）。 */
export function commitAddCustom(store, char) {
  return commitAdd(store, char);
}

// ---------------------------------------------------------------- 视图（纯组件）

function Row({ testid, title, sub = null, value = null, arrow = false, off = false, tall = false, dot = false, onClick = null, subSmall = false, extra = {} }) {
  const inner = html`<span class="sz-drow__main">
      <span class=${off ? 'sz-drow__title sz-drow__title--off' : 'sz-drow__title'}>${dot
        ? html`<span class="sz-drow__dot" aria-hidden="true" data-testid="detail-list-dot"></span>` : null}${title}</span>
      ${sub ? html`<span class=${subSmall ? 'sz-drow__sub sz-drow__sub--small' : 'sz-drow__sub'}>${sub}</span>` : null}
    </span>
    ${value ? html`<span class="sz-drow__value">${value}</span>` : null}
    ${arrow ? html`<${Chevron} />` : null}`;
  const cls = tall ? 'sz-drow sz-drow--tall' : 'sz-drow';
  if (onClick) {
    return html`<${Button} variant="plain" class=${cls} data-testid=${testid} ...${extra} onClick=${onClick}>${inner}</${Button}>`;
  }
  return html`<div class=${cls} data-testid=${testid} ...${extra}>${inner}</div>`;
}

/** 详情页里的三段式（S1）：全 App 同一个组件（components/FailBlock.js），这里只套上详情页的行间距。 */
export function FailBlock({ testid, note, onCancel, onRetry }) {
  return html`<div class="sz-dfail">
    ${SharedFailBlock({ testid: testid, text: note, cancelLabel: t('X-DETAIL.cancel'), retryLabel: t('X-DETAIL.retry'), onCancel: onCancel, onRetry: onRetry })}
  </div>`;
}

/**
 * 列表行。
 * @param {object} p
 * @param {object} p.model           records.js detailModel
 * @param {Function|null} p.onList   (kind) => void；没有去处时写错过 / 快忘了行不可点
 * @param {Function|null} p.onImage  M4-5 注册的做图片去处；null 时不显示这一行
 * @param {Function} p.onLegacy / p.onSwap / p.onRemove
 * @param {boolean} p.swapFailed
 */
export function DetailRows({ model, onList = null, onImage = null, onLegacy, onSwap, onSwapCancel, onRemove, onRemoveCancel = null, swapFailed = false, removeFailed = false,
  onAdd = null, onAddCancel = null, addFailed = false }) {
  const rows = [];
  if (model.list) {
    const wrong = model.list === 'wrong';
    rows.push(html`<${Row} key="list" testid="detail-list-row" tall=${true} dot=${wrong}
      title=${t('X-LIBFOUR.zone.due')}
      sub=${t(wrong ? 'R-D01.wrongLine' : 'R-D01.forgetLine')} arrow=${!!onList}
      onClick=${onList ? () => onList(model.list) : null} extra=${{ 'data-list': model.list }} />`);
  }
  if (model.due) {
    rows.push(html`<${Row} key="next" testid="detail-next" title=${t('R-D02.nextReview', { date: dayText(model.due) })} />`);
  }
  if (onImage) {
    if (model.image === 'ok') {
      rows.push(html`<${Row} key="image" testid="detail-image" title=${t('R-D04.makeImage')} arrow=${true}
        onClick=${() => onImage({ char: model.char, cardKey: model.cardKey, record: model.imageRecord || model.latest })} extra=${{ 'data-state': 'ok' }} />`);
    } else {
      const note = model.image === 'noInk' ? tInk('R-D04.noInkNote') : t('R-D04.noRecordNote');
      rows.push(html`<${Row} key="image" testid="detail-image" title=${t('R-D04.makeImage')} off=${true} sub=${note}
        extra=${{ 'data-state': model.image, 'aria-disabled': 'true' }} />`);
    }
  }
  if (model.photo) {
    rows.push(html`<${Row} key="legacy" testid="detail-legacy" title=${t('X-DETAIL.legacyEntry')} arrow=${true} onClick=${onLegacy} />`);
  }
  if (model.canSwapWord) {
    rows.push(html`<${Row} key="swap" testid="detail-swap" title=${t('R-D05.swapWord')} onClick=${onSwap} />`); // 一点即生效，不是去处，行尾不带「›」（I3 · P1-18）
    if (swapFailed) {
      rows.push(html`${FailBlock({ key: 'swapfail', testid: 'detail-swap-fail', note: t('X-DETAIL.saveFailed'), onCancel: onSwapCancel, onRetry: onSwap })}`);
    }
  }
  if (model.custom) {
    rows.push(html`<${Row} key="remove" testid="detail-remove" title=${t('R-D06.rowTitle')} sub=${t('R-D06.rowSub')} subSmall=${true}
      onClick=${onRemove} />`);
    if (removeFailed) {
      rows.push(html`<${FailBlock} key="removefail" testid="detail-remove-fail" note=${t('X-DETAIL.saveFailed')} onCancel=${onRemoveCancel}
        onRetry=${onRemove} />`);
    }
  }
  // D66 ⑮：不在自选里的字可以加入自选（与查字卡同一个函数）；一点即生效、不提示（成功后这一行自己变成上面的「移出自选」）
  if (!model.custom && model.practicable && onAdd) {
    rows.push(html`<${Row} key="add" testid="detail-add" title=${t('R-Q05.btnAdd')} onClick=${onAdd} />`);
    if (addFailed) {
      rows.push(html`<${FailBlock} key="addfail" testid="detail-add-fail" note=${t('X-DETAIL.saveFailed')} onCancel=${onAddCancel} onRetry=${onAdd} />`);
    }
  }
  return html`<div class="sz-drows" data-testid="detail-rows">${rows}</div>`;
}
