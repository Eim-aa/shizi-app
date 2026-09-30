// 图片入口（02 M4-5；01 §10；04 R-I01–R-I04、R-R07、R-P03、R-D04、R-M01 / R-P02、A05；03 P02 / P25 / P50）。
// 由 ui/root.js 加载一次：把「做图片」的去处注册给各页（各页没注册时入口不显示）——
//   结果页「这次的图片」        setResultImageAction(fn({slot, sessionId, chars}))        → 这次的图片（本组每字最后一次判断，D11）
//   单字详情「把这个字做成图片」 setDetailImageAction(fn({char, cardKey, record}))         → 手写字图片（最近一次，A05）
//   我的 / 练习记录「保存图片 ›」 setMineImageActions({month({month}), today({day})})       → {月}字帖（P02 本月第一次）/ 这天写的字
// 然后打开预览弹层（components/image-preview.js），分享 / 保存走 platform/share.js。
// 选字与取墨口径在 core/images/pick.js（纯函数），版式在 core/images/layout.js，绘制在 core/images/render.js。
//
// 取墨：这条记录存下的墨迹（shizi.v2.ink.<月>，perRecordInk）→ 本页面会话里刚判断时记下的笔画（write/compare.js recalledInk，
//   与结果页格子、单字详情、清单小图同一取法）→ 没有 = 缺墨（P50 不画进图并说明，落款字数跟着减，I03 不借别次）。
// 所有函数只读 store，不写任何东西。
import { nav } from './router.js';
import { getStore } from '../store/store.js';
import { t } from '../config/copy/index.js';
import * as defaultPolicy from '../config/policy.js';
import { now as envNow } from '../platform/env.js';
import { cnNumber, localDay, monthDayParts, signatureDateParts, signatureMonthParts } from '../core/dates.js';
import { decodeInk, resampleForReplay } from '../core/ink-math.js';
import { imagePlan } from '../core/images/pick.js';
import { renderSheet, renderSingleGlyph } from '../core/images/render.js';
import { cardForKey } from '../data/deck.js';
import { paintBrushStroke } from './canvas/brush.js';
import { requireCanvasFont } from '../data/font-loader.js';
import { ImagePreview, IMAGE_OVERLAY } from './components/image-preview.js';
import { builtFromRaw, recalledInk } from './screens/write/compare.js';
import { setResultImageAction } from './screens/result/index.js';
import { setDetailImageAction } from './screens/detail/index.js';
import * as mineRecords from './screens/mine/records.js';

function storeOrNull() {
  try {
    return getStore();
  } catch (error) {
    return null;
  }
}

/** 一条记录的笔迹点列（345 单位，绝对宽）：存下的墨迹 → 本页面会话里记下的笔画 → null。 */
export function inkPointsOf(store, record) {
  if (!record) return null;
  if (store && typeof store.getInk === 'function') {
    let ink = null;
    try {
      ink = store.getInk(record);
    } catch (error) {
      ink = null;
    }
    const decoded = ink ? decodeInk(ink) : null;
    if (decoded && decoded.length) return resampleForReplay(decoded);
  }
  const raw = recalledInk(record.id);
  if (raw && raw.length) {
    const built = builtFromRaw(raw);
    if (built.some(s => s && s.length)) return built;
  }
  return null;
}

const quote = chars => chars.map(c => `「${c}」`).join('');

/**
 * 落款计数：汉字数字（文案-D3），与我的页字帖落款（mine/records.js signatureText）同用 core/dates.js cnNumber（2 → 「二」）。
 * 原型 ShiziScreen cn() 把 2 写成「两」（reference/J-proto-screen.md L45）——两处不一致，已登记待定，改时两处一起改。
 */
export function countCn(n) {
  return cnNumber(n);
}

function dateText(day) {
  return day ? t('R-H02.dateFormat', monthDayParts(day)) : '';
}

/** 落款：这次的图片 / 这天写的字「二〇二六年九月二十四日 · 五个字」（R-P03 / Y03）；月字帖「二〇二六年九月 · 有记录二十二天 · 八十个字」。 */
export function signatureOf(plan) {
  if (plan.kind === 'month') {
    return t('R-I01.monthSignature', {
      month: t('R-I01.signatureMonth', signatureMonthParts(plan.month)),
      n: countCn(plan.days || 0),
      m: countCn(plan.n),
    });
  }
  if (!plan.day) return '';
  return t('R-P03.signature', { date: t('R-I01.signatureDate', signatureDateParts(plan.day)), n: countCn(plan.n) });
}

function titleOf(plan) {
  if (plan.kind === 'month') return t('R-I01.kindMonth', { month: Number(plan.month.slice(5)) });
  if (plan.kind === 'glyph') return t('R-I01.kindGlyph');
  return t('R-I01.kindSession');
}

function noteOf(plan) {
  if (plan.kind === 'glyph') return t('R-I01.glyphNote');
  const miss = plan.missing.length
    ? t(plan.kind === 'month' ? 'X-IMAGES.missingMonth' : 'X-IMAGES.missingSession', { chars: quote(plan.missing) })
    : '';
  return miss + t('R-I01.imageNote');
}

function emptyNoteOf(plan) {
  if (plan.kind === 'glyph') return t('R-D04.noInkNote');
  if (plan.kind === 'month') return t('X-IMAGES.emptyMonth');
  return t('R-R07.allMissing');
}

/** 单字图下一行「jìng · 9 月 22 日」（R-I02；拼音按 P20 取 deck py；没有拼音只写日期）。 */
export function glyphCaption(record, lookup = cardForKey) {
  const card = lookup(record.cardKey);
  const pinyin = card && card.py ? card.py : '';
  const date = dateText(record.localDay);
  return pinyin ? t('R-I02.glyphCaption', { pinyin, date }) : date;
}

function fileName(plan, ratio) {
  const r = ratio === 'square' ? '1x1' : '3x4';
  const key = String(plan.key || '').replace(/[^0-9A-Za-z㐀-鿿-]/g, '');
  return `shizi-${plan.kind}-${key}-${r}.png`;
}

/**
 * 组一个预览任务（job）。state 缺省读 store；inkOf 缺省按 inkPointsOf。
 * @param {{kind:'session'|'day'|'month'|'glyph', slot?, sessionId?, day?, month?, char?}} scope
 */
export function buildImageJob(scope, { state = null, store = storeOrNull(), inkOf = null, policy = defaultPolicy, lookup = cardForKey } = {}) {
  const st = state || (store ? store.getState() : null);
  const plan = imagePlan(st, scope, { inkOf: inkOf || (record => inkPointsOf(store, record)), policy });
  const meta = {
    kind: plan.kind,
    key: plan.key,
    plan: plan.status,
    missing: plan.missing.join(''),
    days: plan.days == null ? '' : plan.days,
    day: plan.day || '',
    month: plan.month || '',
    pick: plan.kind === 'month' ? policy.monthSheetPick : plan.kind === 'glyph' ? 'latest' : 'last',
  };
  const sealText = t('X-IMAGES.seal');
  const render = async ratio => {
    if (plan.kind === 'glyph') {
      if (plan.status !== 'ready') return { status: plan.status, canvas: null };
      const cell = plan.drawn[0];
      return renderSingleGlyph({
        points: cell.points,
        caption: glyphCaption(cell.record, lookup),
        signatureText: t('X-IMAGES.brand'),
        sealText,
        ratio,
        paintStroke: paintBrushStroke,
        requireFont: requireCanvasFont,
        meta: { ...meta, members: cell.char, recordIds: cell.record.id, day: cell.record.localDay },
      });
    }
    if (plan.status === 'empty') return { status: 'empty', canvas: null };
    return renderSheet({
      items: plan.drawn,
      ratio,
      signature: signatureOf(plan),
      sealText,
      maxChars: plan.maxChars,
      paintStroke: paintBrushStroke,
      requireFont: requireCanvasFont,
      meta,
    });
  };
  return {
    kind: plan.kind,
    plan,
    title: titleOf(plan),
    note: noteOf(plan),
    emptyNote: emptyNoteOf(plan),
    signature: plan.kind === 'glyph' ? t('X-IMAGES.brand') : plan.status === 'ready' ? signatureOf(plan) : '',
    render,
    fileName: ratio => fileName(plan, ratio),
  };
}

/** 打开预览弹层；返回 overlay id。 */
export function openImage(scope, opts) {
  const job = buildImageJob(scope, opts);
  return nav.openOverlay(ImagePreview, { job }, { name: IMAGE_OVERLAY });
}

export function openSessionImage({ slot = null, sessionId }) {
  return openImage({ kind: 'session', slot, sessionId });
}

export function openDayImage({ day }) {
  return openImage({ kind: 'day', day });
}

export function openMonthImage({ month } = {}) {
  const m = typeof month === 'string' && month ? month : localDay(envNow()).slice(0, 7);
  return openImage({ kind: 'month', month: m });
}

export function openGlyphImage({ char }) {
  return openImage({ kind: 'glyph', char });
}

/** 注册到各页（加载本模块时执行一次；测试可再调）。 */
export function registerImageEntries() {
  setResultImageAction(({ slot, sessionId }) => openSessionImage({ slot, sessionId }));
  setDetailImageAction(({ char }) => openGlyphImage({ char }));
  if (typeof mineRecords.setMineImageActions === 'function') {
    mineRecords.setMineImageActions({
      month: ({ month }) => openMonthImage({ month }),
      today: ({ day }) => openDayImage({ day }),
    });
  }
}

registerImageEntries();
