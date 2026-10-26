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
import { nav, registerScreen } from './router.js';
import { getStore } from '../store/store.js';
import { t, tInk } from '../config/copy/index.js';
import * as defaultPolicy from '../config/policy.js';
import { cnCount, localDay, monthDayParts } from '../core/dates.js';
import { now as envNow } from '../platform/env.js';
import { decodeInk, resampleForReplay } from '../core/ink-math.js';
import { imagePlan } from '../core/images/pick.js';
import { RATIO_OF_LABEL } from '../core/images/glyph-layout.js';
import { defaultRatio, EXPORT_SCALE } from '../core/images/layout.js';
import { paintCellContent, renderSheetPage, renderSingleGlyph, renderWorkPage } from '../core/images/render.js';
import { cardForKey, isPracticable } from '../data/deck.js';
import { loadStrokes } from '../data/strokes.js';
import { paintBrushStroke } from './canvas/brush.js';
import { requireCanvasFont } from '../data/font-loader.js';
import { ImagePreview, IMAGE_OVERLAY, PREVIEW_SCALE_MANY, exportImage, failText, noteOf, saveImageFile, withExt } from './components/image-preview.js';
import { builtFromRaw, recalledInk } from './screens/write/compare.js';
import { commitAdded, setResultImageAction } from './screens/result/index.js';
import { setDetailImageAction } from './screens/detail/index.js';
import * as mineRecords from './screens/mine/records.js';
import { recordHasInk } from './screens/detail/records.js';
import { kuan } from './work-text.js';
import { buildAnnualJob } from './images-annual.js';
import { setImageActions } from '../session/api/image.js';
import { textLineStarts } from './screens/result/native-view.js';
import { postNative } from '../platform/bridge.js';
import { isNativeShell } from '../platform/env.js';

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
          ratio: RATIO_OF_LABEL[ratio] || 'portrait',
          paintStroke: paintBrushStroke,
          requireFont: requireCanvasFont,
          meta: { kind: 'glyph', members: cell.char, recordIds: cell.record.id, day: cell.record.localDay },
        });
        return { status: out.status, canvas: out.canvas };
      }
      if (p.status !== 'ready') return { status: p.status, canvas: null };
      const cells = p.pages[i] || [];
      const render = p.kind === 'month' ? renderSheetPage : renderWorkPage; // 月字帖：字帖格版式（D57，与「我的」页、月字帖页同一个 sheetGrid）
      const out = await render({
        cells, ratio, kuan: kuanFor(p, i, p.pages.length, cells), scale, ...renderDeps(),
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
  if (nativePreviewOn()) return openNativePreview(scope);
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

// ---------------------------------------------------------------- B3.11：原生图片预览弹层
//
// 原生弹层（ShiziScreen_image_preview）替掉网页弹层：原生只说「要生成哪张图」（scope），图与文案都由页面用**同一批函数**给出
// （buildImageJob / buildAnnualJob / job.renderPage / noteOf / failText），所以两边逐字、逐像素一致。
// 网页 → 原生：网页这一侧不再开自己的弹层，改发 {type:'native', op:'open', screen:'image-preview'}（原生屏名清单里有它才有原生弹层）。
// 原生 → 网页：原生弹层用 image.render / image.view / image.add / image.save 这几个 op。

/** 原生有没有图片预览弹层（壳注入的原生屏名清单里有 image-preview）。 */
export function nativePreviewOn(win = typeof window !== 'undefined' ? window : null) {
  if (!isNativeShell(win)) return false;
  const list = win && Array.isArray(win.__shiziNativeScreens) ? win.__shiziNativeScreens : [];
  return list.indexOf('image-preview') >= 0;
}

let nativeSeq = 0;

/** scope → 交给原生的参数（只带可序列化的字段）。 */
export function plainScope(scope) {
  const s = scope && typeof scope === 'object' ? scope : {};
  const out = { kind: s.kind === 'day' || s.kind === 'month' || s.kind === 'glyph' || s.kind === 'annual' ? s.kind : 'session' };
  if (s.slot != null) out.slot = s.slot;
  if (s.sessionId != null) out.sessionId = s.sessionId;
  if (s.day != null) out.day = s.day;
  if (s.month != null) out.month = s.month;
  if (s.char != null) out.char = s.char;
  if (s.year != null) out.year = s.year;
  return out;
}

/** 请原生开图片预览弹层（返回这次打开的 id）。 */
export function openNativePreview(scope) {
  nativeSeq += 1;
  const entryId = `image-preview-${nativeSeq}`;
  postNative('native', { op: 'open', screen: 'image-preview', entryId, params: { scope: plainScope(scope) }, via: 'quiet' });
  return entryId;
}

/** 原生弹层关掉了：原生发 image.closed，网页把这条原生屏从原生栈里收掉（不发 nav.back —— 网页栈里没有这一层）。 */
export function closeNativePreview(entryId) {
  if (!entryId) return { ok: true };
  const screen = String(entryId).indexOf('image-toast') === 0 ? 'image-toast' : 'image-preview';
  postNative('native', { op: 'close', screen, entryId });
  return { ok: true };
}

/** scope → job（网页弹层与原生弹层同一批函数）。 */
export function jobOf(scope, ctx = null) {
  const s = scope && typeof scope === 'object' ? scope : {};
  const store = ctx && typeof ctx.getStore === 'function' ? ctx.getStore() : null;
  if (s.kind === 'annual') return buildAnnualJob(Object.assign(store ? { store } : {}, s.year == null ? {} : { year: s.year }));
  const kind = s.kind === 'day' || s.kind === 'month' || s.kind === 'glyph' ? s.kind : 'session';
  const scopeArg = {
    kind,
    slot: s.slot == null ? null : s.slot,
    sessionId: s.sessionId,
    day: s.day,
    month: s.month,
    char: s.char,
  };
  return buildImageJob(scopeArg, store ? { store } : undefined);
}

/** 「也放进来」chip 的小图（32pt 的方格）：与屏上 CellCanvas 同一支画法（paintCellContent）与同一组颜色（--hand / --under）。 */
export function chipThumb(ch, ink, size = 32) {
  const points = ink && Array.isArray(ink.points) ? ink.points : null;
  if (typeof document === 'undefined' || !points || !points.length) return '';
  try {
    const dpr = 2;
    const canvas = document.createElement('canvas');
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 颜色取令牌（--hand / --under 在 :root 上）；取不到就不出图（不写死颜色）
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
    const hand = style && style.getPropertyValue('--hand').trim();
    const under = style && style.getPropertyValue('--under').trim();
    if (!hand) return '';
    paintCellContent(ctx, { ch, ink: points, mode: 'hand' }, { x: 0, y: 0, c: size },
      { palette: { hand, under: under || hand }, unit: 1, paintStroke: paintBrushStroke });
    return canvas.toDataURL('image/png');
  } catch (error) {
    return '';
  }
}

/**
 * 说明句的折行点（网页量的，给原生照着换行）。
 * .sz-img__note 是 text-wrap: pretty 的段落：WebKit 按整段平衡折行，原生（CoreText）贪心折行，两边折点不一样——
 * 与结果页同一做法（B2.7 native-view.js webLineStarts）：页面里用同一组 CSS 类排一份看不见的副本，量出每一行从第几个字开始。
 * @param {string} text 段落文字
 * @param {string} wrapClass 容器的类（网页上这段所在的容器）
 * @param {string} cls 段落自己的类
 */
export function lineStartsOf(text, wrapClass, cls) {
  if (!text || typeof document === 'undefined') return null;
  const vw = document.documentElement.clientWidth || 402;
  const width = Math.max(1, vw - 2 * gutterPx()); // .sz-sheet 的左右内边
  try {
    return textLineStarts(text, { wrapClass, cls }, width);
  } catch (error) {
    return null;
  }
}

/** 页边（--gutter）的数值；T.gutter 是 CSS 变量字符串（var(--gutter)），这里要的是数值（与结果页 sw − 40 同一口径）。 */
function gutterPx() {
  try {
    const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter'));
    return Number.isFinite(n) && n > 0 ? n : 20;
  } catch (error) {
    return 20;
  }
}

/** 预览弹层的视图模型（原生按它画；文案都是成句的，参数已在这一侧拼好）。 */
export function imageView(scope, ratio, ctx = null) {
  const job = jobOf(scope, ctx);
  const r = ratio || job.initialRatio || (job.ratios && job.ratios[0]) || '3:4';
  const total = job.pageCount();
  const status = job.status();
  const note = noteOf({ state: status, saveFailed: false, job, total });
  const boardNote = status === 'ready' ? '' : noteOf({ state: status, saveFailed: false, job });
  const saveLabel = typeof job.saveLabel === 'function' ? job.saveLabel(total)
    : (total > 1 ? t('X-WORK.saveMany', { m: total }) : t('X-IMAGES.save'));
  const chips = typeof job.chips === 'function' ? job.chips() : [];
  const failTexts = {
    share: failText({ kind: 'share' }),
    render: failText({ reason: 'render' }),
    denied: failText({ reason: 'denied' }),
    save: failText({ reason: 'download' }),
  };
  return {
    kind: job.kind,
    title: job.title,
    ratios: (job.ratios || []).slice(),
    ratio: r,
    initialRatio: job.initialRatio || r,
    pageCount: total,
    status,
    note,
    noteStarts: lineStartsOf(note, 'sz-img', 'sz-img__note'),
    boardNote,
    saveLabel,
    shareLabel: t('R-B10.share'),
    chips: chips.map(c => ({ recordId: c.recordId, ch: c.ch, on: !!c.on, thumb: chipThumb(c.ch, c.ink) })),
    alt: job.alt ? { label: job.alt.label, note: job.alt.note || '' } : null,
    failText: failTexts,
    // 失败说明句（.sz-fail__note）也是 text-wrap: pretty 的段落：折行点按四种文案各量一次
    failStarts: Object.fromEntries(
      Object.entries(failTexts)
        .map(([k, v]) => [k, lineStartsOf(v, 'sz-fail', 'sz-fail__note')])
        .filter(([, v]) => v != null),
    ),
  };
}

/** 画一页（预览倍率与导出倍率同网页：≤ 3 页用导出倍率，多页用小倍率）。 */
export async function imageRender(scope, ratio, page, mode, ctx = null) {
  const job = jobOf(scope, ctx);
  const r = ratio || job.initialRatio || (job.ratios && job.ratios[0]) || '3:4';
  const total = job.pageCount();
  const scale = mode === 'export' ? EXPORT_SCALE : (total <= 3 ? EXPORT_SCALE : PREVIEW_SCALE_MANY);
  const res = await job.renderPage(page, r, { scale });
  if (!res || res.status !== 'ready' || !res.canvas) {
    return { ok: true, image: { status: (res && res.status) || 'renderFailed', dataURL: '', width: 0, height: 0, name: '' } };
  }
  const canvas = res.canvas;
  return {
    ok: true,
    image: {
      status: 'ready',
      dataURL: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
      name: job.fileName(r, page, total),
    },
  };
}

/** 「也放进来」：网页弹层同一个 toggleChip（commitAdded）。 */
export function imageAdd(scope, recordId, ctx = null) {
  const job = jobOf(scope, ctx);
  if (typeof job.toggleChip !== 'function') return { ok: false, error: { kind: 'unsupported' } };
  job.toggleChip(recordId);
  return { ok: true };
}

/** 保存到相册：每一页按导出倍率重画，交给原生写相册（等原生回包）。与网页 saveAll 同一口径。 */
export async function imageSave(scope, ratio, mode, ctx = null) {
  const job = jobOf(scope, ctx);
  const r = ratio || job.initialRatio || (job.ratios && job.ratios[0]) || '3:4';
  if (mode === 'long') {
    if (!job.alt) return { ok: false, error: { kind: 'render' } };
    let canvases = [];
    try {
      canvases = await job.alt.render();
    } catch (error) {
      canvases = [];
    }
    if (!canvases.length) return { ok: false, error: { kind: 'render' } };
    return saveAll(job, canvases, (i, n) => job.alt.fileName(i, n));
  }
  const total = job.pageCount();
  return saveAll(job, null, (i, n) => job.fileName(r, i, n), total, r);
}

/** 逐页保存（与网页 image-preview.js 的 saveAll 同一口径：任一页失败就停，回原因）。 */
async function saveAll(job, canvases, nameOf, total = 0, ratio = null) {
  const count = canvases ? canvases.length : total;
  for (let i = 0; i < count; i += 1) {
    let one;
    let canvas = null;
    try {
      canvas = canvases ? canvases[i] : (await job.renderPage(i, ratio, { scale: EXPORT_SCALE })).canvas;
      one = await saveImageFile(withExt({ dataURL: exportImage(canvas), name: nameOf(i, count), kind: job.kind }));
    } catch (error) {
      one = { ok: false, reason: canvas ? 'download' : 'render' };
    }
    if (!one || !one.ok) {
      const reason = (one && one.reason) || (one && one.via === 'native' ? 'denied' : 'download');
      return { ok: false, error: { kind: reason } };
    }
  }
  return { ok: true, via: 'native' };
}

/** App API 的动作（会话层不导入 UI：网页图片模块加载时登记**同一个函数对象**）。 */
setImageActions({
  view: (args, ctx) => ({ ok: true, view: imageView(args && args.scope, args && args.ratio, ctx) }),
  render: (args, ctx) => imageRender(args && args.scope, args && args.ratio, Number((args && args.page) || 0), args && args.mode, ctx),
  add: (args, ctx) => imageAdd(args && args.scope, args && args.recordId, ctx),
  save: (args, ctx) => imageSave(args && args.scope, args && args.ratio, args && args.mode, ctx),
  closed: args => closeNativePreview(args && args.entryId),
});

// B3.11：图片预览弹层与失败提示条的原生宿主屏（原生有 ShiziScreen_image_preview / ShiziScreen_image_toast 两个类时由原生出，
// 壳把有类的屏名清单注入 window.__shiziNativeScreens）。网页这一侧只是「声明这两个屏有原生实现」——
// 真正开弹层走原生消息（native 屏 + open），网页路由里没有这两屏。
registerScreen('image-preview', () => null, { native: true });
registerScreen('image-toast', () => null, { native: true });

registerImageEntries();
