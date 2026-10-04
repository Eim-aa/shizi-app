// 图片入口（阶段 1 P1-E7；交接 §5.3 / §6 / §7；02 M4-5；01 §10；04 R-I01–R-I04、R-P03、R-D04、A05；D31 / D39 / D42 / D46 / D47）。
// 由 ui/root.js 加载一次：把「做图片」的去处注册给各页（各页没注册时入口不显示）——
//   结果页右上「分享」           setResultImageAction(fn({slot, sessionId}))              → 这次的图片（作品成员规则，D31）
//   单字详情「把这个字做成图片」  setDetailImageAction(fn({char, cardKey, record}))         → 手写字图片（最近一次，A05）
//   我的 / 练习记录「保存图片 ›」 setMineImageActions({month({month}), today({day})})       → {月}字帖 / 这天写的字
//   月字帖页 / 年报页的分享      openMonthImage / openAnnualImage（直接调用）
// 然后打开分享弹层（components/image-preview.js），分享 / 保存走 platform/share.js。
// 选字与取墨口径在 core/images/pick.js + work.js（纯函数），版式在 core/images/layout.js，绘制在 core/images/render.js，分页在 paginate.js。
//
// 取墨：这条记录存下的墨迹（shizi.v2.ink.<月>，perRecordInk）→ 本页面会话里刚判断时记下的笔画（write/compare.js recalledInk，
//   与结果页格子、单字详情、清单小图同一取法）→ 没有 = 无墨（作品里不收；月字帖 / 年报里画 under 衬底；I03 不借别次）。
// D42：这次 / 这天 / 这个月按时间段取「某一次」，每字先在该时间段内按偏好顺序找留有墨迹的那一次（core/ink-pick.js），段内一份都没有才算无墨。
// 所有函数只读 store；唯一的写是分享弹层里「也放进来」（经 result/index.js commitAdded → store.commit，写进本组会话的 added）。
import { nav } from './router.js';
import { getStore } from '../store/store.js';
import { t, tInk } from '../config/copy/index.js';
import * as defaultPolicy from '../config/policy.js';
import { cnCount, localDay, monthDayParts } from '../core/dates.js';
import { now as envNow } from '../platform/env.js';
import { decodeInk, resampleForReplay } from '../core/ink-math.js';
import { imagePlan } from '../core/images/pick.js';
import { RATIO_OF_LABEL } from '../core/images/glyph-layout.js';
import { defaultRatio } from '../core/images/layout.js';
import { renderSingleGlyph, renderWorkPage } from '../core/images/render.js';
import { cardForKey, isPracticable } from '../data/deck.js';
import { loadStrokes } from '../data/strokes.js';
import { paintBrushStroke } from './canvas/brush.js';
import { requireCanvasFont } from '../data/font-loader.js';
import { ImagePreview, IMAGE_OVERLAY } from './components/image-preview.js';
import { builtFromRaw, recalledInk } from './screens/write/compare.js';
import { commitAdded, setResultImageAction } from './screens/result/index.js';
import { setDetailImageAction } from './screens/detail/index.js';
import * as mineRecords from './screens/mine/records.js';
import { recordHasInk } from './screens/detail/records.js';
import { kuan } from './work-text.js';

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

/**
 * 落款计数：汉字数字（文案-D3），与所有落款（work-text.js kuan）同用 core/dates.js cnCount
 * （2 → 「两」，200 → 「两百」，12 → 「十二」；已决定 D36，与原型 ShiziScreen cn() 一致；年份仍是 cnDigits）。
 */
export function countCn(n) {
  return cnCount(n);
}

function dateText(day) {
  return day ? t('R-H02.dateFormat', monthDayParts(day)) : '';
}

function titleOf(plan) {
  if (plan.kind === 'month') return t('X-WORK.monthTitle', { month: Number(plan.month.slice(5)) });
  if (plan.kind === 'glyph') return t('R-I01.kindGlyph');
  return t('R-I01.kindSession');
}

function emptyNoteOf(plan) {
  if (plan.kind === 'glyph') return tInk('R-D04.noInkNote');
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

const RATIO_FILE = Object.freeze({ '3:4': '3x4', '1:1': '1x1' });

function fileName(plan, ratio, i, total) {
  const key = String(plan.key || '').replace(/[^0-9A-Za-z㐀-鿿-]/g, '');
  const page = total > 1 ? `-${i + 1}of${total}` : '';
  return `shizi-${plan.kind}-${key}-${RATIO_FILE[ratio] || '3x4'}${page}.jpg`;
}

/** 参考字形的笔顺数据：题库外的字没有数据文件，不去取（退回楷体整字，render.js paintFallbackGlyph）。 */
export async function loadGlyphData(ch) {
  return isPracticable(`base:${ch}`) ? loadStrokes(ch) : null;
}

/** 渲染所需的注入口（笔锋、字体加载确认、参考字形）。 */
export function renderDeps() {
  return { paintStroke: paintBrushStroke, requireFont: requireCanvasFont, loadGlyph: loadGlyphData };
}

/**
 * 组一个分享弹层的任务（job；形状见 components/image-preview.js 头注）。
 * state 缺省读 store；inkOf 缺省按 inkPointsOf。每次取页面 / 状态都重读 store，所以「也放进来」之后弹层重画就是最新成员。
 * @param {{kind:'session'|'day'|'month'|'glyph', slot?, sessionId?, day?, month?, char?}} scope
 */
export function buildImageJob(scope, { state = null, store = storeOrNull(), inkOf = null, policy = defaultPolicy, lookup = cardForKey } = {}) {
  const planNow = () => {
    const st = state || (store ? store.getState() : null);
    // D42：每字在时间段内挑「留有墨迹的那一次」——注入 inkOf（单测）时按它的结果判断，界面缺省走廉价的存在性判据（不解码）。
    return imagePlan(st, scope, {
      inkOf: inkOf || (record => inkPointsOf(store, record)),
      hasInk: inkOf ? null : record => recordHasInk(store, record),
      policy,
    });
  };
  const plan = planNow();
  const kuanFor = (p, i, pages, cells) => {
    if (p.kind === 'month') return kuan({ month: p.month, n: cells.length, part: i + 1, of: pages });
    return kuan({ day: p.day, n: cells.length, part: i + 1, of: pages });
  };
  const sealText = t('X-IMAGES.seal');
  const job = {
    kind: plan.kind,
    plan,
    title: titleOf(plan),
    note: '',
    emptyNote: emptyNoteOf(plan),
    ratios: ['3:4', '1:1'],
    // D47 管作品（结果页 / 月字帖 / 这天）；单字手写图（A05）不属于作品版式，沿用 3:4
    initialRatio: plan.kind === 'glyph' ? '3:4' : defaultRatio(plan.n),
    signature: plan.status === 'ready' && plan.kind !== 'glyph' ? kuanFor(plan, 0, plan.pages.length, plan.pages[0] || []) : plan.kind === 'glyph' ? t('X-IMAGES.brand') : '',
    status: () => planNow().status,
    pageCount: () => (planNow().pages.length || 1),
    splitNote: total => t('X-WORK.splitNote', { n: planNow().n, m: total, max: plan.maxChars }),
    renderPage: async (i, ratio, { scale } = {}) => {
      const p = planNow();
      if (p.kind === 'glyph') {
        if (p.status !== 'ready') return { status: p.status, canvas: null };
        const cell = p.drawn[0];
        const out = await renderSingleGlyph({
          points: cell.points,
          caption: glyphCaption(cell.record, lookup),
          signatureText: t('X-IMAGES.brand'),
          sealText,
          ratio: RATIO_OF_LABEL[ratio] || 'portrait',
          paintStroke: paintBrushStroke,
          requireFont: requireCanvasFont,
          meta: { kind: 'glyph', members: cell.char, recordIds: cell.record.id, day: cell.record.localDay },
        });
        return { status: out.status, canvas: out.canvas };
      }
      if (p.status !== 'ready') return { status: p.status, canvas: null };
      const cells = p.pages[i] || [];
      const out = await renderWorkPage({
        cells, ratio, kuan: kuanFor(p, i, p.pages.length, cells), sealText, scale, ...renderDeps(),
        meta: { kind: p.kind, key: p.key, plan: p.status, day: p.day || '', month: p.month || '', days: p.days == null ? '' : p.days, page: i + 1, pages: p.pages.length },
      });
      return { status: out.status, canvas: out.canvas };
    },
    fileName: (ratio, i, total) => fileName(plan, ratio, i, total),
  };
  if (plan.kind === 'session') {
    job.watch = cb => (store ? store.subscribe(cb) : () => {});
    job.chips = () => {
      const p = planNow();
      return (p.work ? p.work.addable : []).map(e => ({
        recordId: e.recordId, ch: e.char, on: e.state === 'added', ink: { points: inkOf ? inkOf(e.record) : inkPointsOf(store, e.record) },
      }));
    };
    job.toggleChip = recordId => {
      const st = store || storeOrNull();
      if (st) commitAdded(st, { slot: scope.slot || null, sessionId: scope.sessionId, recordId });
    };
  }
  return job;
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
