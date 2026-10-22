// 原生结果页的视图数据（B2.7；页面侧，注入写字会话 API 的 deps.result.view）。
//
// 标准答案是网页结果页：这里调用网页结果页**同一批**函数（resultModel、buildWork、resultGrid、dotLayout、kuan、workAria、rowText…）把这一页要画的
// 每一样算好交给原生——作品格的列 × 行与格宽、外框矩形、每格的字 / 读屏名称 / 本人笔迹（桥上紧凑原始点）/ 朱点位置 / 格内小注、落款与印的位置、
// 没放进图里的行（文字、状态、朱点、「修改 ›」「放进图里」）、复现句、提醒邀请该不该问与示例、底栏按钮、交接来的撤销机会、落印要不要演。
// 原生只排版与绘制，不另算规则；B3 原生化其余页面时这份视图随会话层一起搬（届时版式函数挪进 src/core/images）。
import { t } from '../../../config/copy/index.js';
import { localDay } from '../../../core/dates.js';
import { now as envNow } from '../../../platform/env.js';
import { dotLayout, INK_PAD, inkWidthScale, resultGrid } from '../../../core/images/layout.js';
import { inkBounds } from '../../../core/images/glyph-layout.js';
import { firstExtras, inkPresent, resultModel } from '../../../session/result-ops.js';
import { inviteShouldShow } from '../../../session/result-api.js';
import { sheetStrokes } from '../../../session/write-api.js';
import { builtInk, frameRects } from '../../components/work.js';
import { SEAL_PT } from '../../components/marks.js';
import { kuan } from '../../work-text.js';
import { cellStateOf, revealPlan, ROW_GLYPH, ROW_GLYPH_AX, ROW_PAD, rowAria, rowText, stateWord, statusWord, workAria } from './work.js';
import { inviteExample } from './first.js';
import { changeLabel } from '../write/result-row.js';
import { dateText, inkOf, resultImageAction } from './index.js';
import { SHI_BOLD_CENTER, SHI_BOLD_PATHS, SHI_BOLD_TRANSFORM, SHI_SEAL_VIEW } from '../../brand/shi.js';

let sealCache = null;
/**
 * 印文「拾」（marks.js SealGlyph 同一组 path 与视框）：换算到印的单位方块（0–1，左上原点），每段 [M x y] / [C x1 y1 x2 y2 x y] / [Z]。
 * 原生按印的边长缩放后填 --on-seal；印内缩 7% 的细线由原生画（marks.js .sz-seal::before 同一规则）。
 */
export function sealGlyphPath() {
  if (sealCache) return sealCache;
  const { tx, ty, scale } = SHI_BOLD_TRANSFORM;
  const ox = SHI_BOLD_CENTER.x - SHI_SEAL_VIEW / 2;
  const oy = SHI_BOLD_CENTER.y - SHI_SEAL_VIEW / 2;
  const u = (x, y) => [Math.round(((x * scale + tx - ox) / SHI_SEAL_VIEW) * 1e5) / 1e5, Math.round(((y * scale + ty - oy) / SHI_SEAL_VIEW) * 1e5) / 1e5];
  const out = [];
  for (const d of SHI_BOLD_PATHS) {
    for (const m of d.matchAll(/([MCZ])([^MCZ]*)/g)) {
      const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
      if (m[1] === 'Z') { out.push(['Z']); continue; }
      const seg = [m[1]];
      for (let i = 0; i + 1 < nums.length; i += 2) seg.push(...u(nums[i], nums[i + 1]));
      out.push(seg);
    }
  }
  sealCache = out;
  return out;
}

function clientWidth() {
  try {
    return document.documentElement.clientWidth || 402;
  } catch (error) {
    return 402;
  }
}

function clockNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * 网页的折行点（B2.7）：原生结果页的段落（首练标题、中途结束一行、复现句、邀请说明）与网页同一个折行——网页这些段落是 text-wrap: pretty
 * （WebKit 按整段平衡折行），原生排版算法不同，自己折出来的行不一样。这里在页面里用同一组 CSS 类排一份看不见的副本，量出每一行从第几个单位开始，
 * 原生按这些位置换行（字的样子仍由原生排）。没有 DOM（node:test）时返回 null（原生按自己的宽度折行）。
 * build(host) 把副本放进 host 并返回单位表：{node, off, len}（一个字）或 {el}（邀请说明里被遮住的那一位 = 一个描边小方框）。
 */
function webLineStarts(build, width) {
  if (typeof document === 'undefined' || !document.body || !(width > 0)) return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;visibility:hidden;pointer-events:none`;
  try {
    const units = build(host);
    document.body.appendChild(host);
    const starts = [];
    let lastTop = null;
    units.forEach((u, i) => {
      let top = null;
      if (u.el) {
        top = u.el.getBoundingClientRect().top;
      } else {
        const r = document.createRange();
        r.setStart(u.node, u.off);
        r.setEnd(u.node, u.off + u.len);
        const rects = r.getClientRects();
        if (rects.length) top = rects[rects.length - 1].top;
      }
      if (top === null) return;
      if (lastTop !== null && top > lastTop + 8) starts.push(i); // 换行 = 竖向跳过半行以上（被遮住的那一位方框下沉 0.12em，不算换行）
      lastTop = top;
    });
    return starts;
  } catch (error) {
    return null;
  } finally {
    host.remove();
  }
}

function textUnits(node) {
  const units = [];
  let off = 0;
  for (const ch of Array.from(node.data)) {
    units.push({ node, off, len: ch.length });
    off += ch.length;
  }
  return units;
}

/** 一段纯文字在某组 CSS 类下的折行点（按 Array.from 的字计）。 */
function textLineStarts(text, { wrapClass, tag = 'p', cls }, width) {
  if (!text) return null;
  return webLineStarts(host => {
    const wrap = document.createElement('div');
    wrap.className = wrapClass;
    const el = document.createElement(tag);
    el.className = cls;
    const node = document.createTextNode(text);
    el.appendChild(node);
    wrap.appendChild(el);
    host.appendChild(wrap);
    return textUnits(node);
  }, width);
}

/** 邀请说明的折行点：单位 = pre 的字 + 示例词的每一位（被遮住的是一个描边小方框）+ post 的字（与 first.js inviteBody 同一结构）。 */
function inviteLineStarts(body, width) {
  return webLineStarts(host => {
    const wrap = document.createElement('div');
    wrap.className = 'sz-invite';
    const p = document.createElement('p');
    p.className = 'sz-invite__body';
    const units = [];
    const addText = text => {
      if (!text) return;
      const node = document.createTextNode(text);
      p.appendChild(node);
      units.push(...textUnits(node));
    };
    if (body.plain) addText(body.plain);
    else {
      addText(body.pre);
      body.word.forEach((ch, i) => {
        if (body.blanks[i]) {
          const box = document.createElement('span');
          box.className = 'sz-blankbox';
          p.appendChild(box);
          units.push({ el: box });
        } else addText(ch);
      });
      addText(body.post);
    }
    wrap.appendChild(p);
    host.appendChild(wrap);
    return units;
  }, width);
}

const dot = (size, ink, pad) => {
  const points = builtInk(ink);
  const d = dotLayout(size, 1, points ? inkBounds(points) : null, pad);
  return { cx: d.cx, cy: d.cy, d: d.d };
};

/**
 * 原生结果页的视图。
 * @param {object} store
 * @param {{slot:'A'|'B', sessionId:string, width?:number, ax?:boolean, undo?:object|null}} o  width = 原生页宽；undo = 写字页交接来的撤销机会（takeSkipUndo 的结果）
 */
export function resultView(store, { slot, sessionId, width = 0, ax = false, undo = null }) {
  const state = store.getState();
  const inkFor = record => inkOf(store, record);
  const model = resultModel(state, { slot, sessionId, hasInk: record => inkPresent(inkFor(record)) });
  const sw = Number.isFinite(width) && width > 0 ? width : clientWidth();
  const session = model.session;
  const work = model.work;
  let workView = null;
  if (work && work.empty) {
    const entries = work.entries;
    if (entries.length) {
      const grid = resultGrid(entries.length, sw);
      workView = {
        empty: true, c: grid.c, cols: grid.cols, rows: grid.rows,
        label: workAria(entries.map(e => e.char), entries.length, dateText(model.day)),
        cells: entries.map(e => {
          const wrongOne = e.judgment === 'wrong' && e.kind === 'judged' && e.state !== 'paper';
          return { index: e.index, char: e.char, recordId: e.recordId || null, kind: e.kind, status: wrongOne ? '' : statusWord(e), label: t('X-WORK.cellAria', { char: e.char, state: cellStateOf(e) }) };
        }),
      };
    }
  } else if (work) {
    const grid = resultGrid(work.cells.length, sw);
    const { cols, rows, c } = grid;
    const n = work.cells.length;
    const lastCol = (n - 1) % cols;
    const below = lastCol === cols - 1;
    workView = {
      empty: false, c, cols, rows,
      frames: frameRects(n, cols, c),
      label: workAria(work.cells.map(e => e.char), n, dateText(model.day)),
      kuan: kuan({ day: model.day, n, picked: model.variant === 'picked' }),
      pad: INK_PAD,
      widthScale: inkWidthScale(c), // 网页 paintCellContent 同一个线宽倍数（小格抬到最小物理线宽）
      sealPath: sealGlyphPath(),
      seal: below ? { below: true, size: SEAL_PT } : { below: false, size: SEAL_PT, x: (lastCol + 1) * c + Math.round(c * 0.12), y: rows * c - SEAL_PT - Math.round(c * 0.06) },
      cells: work.cells.map(e => {
        const ink = inkFor(e.record);
        return {
          index: e.index, char: e.char, recordId: e.recordId || null, kind: e.kind, state: e.state,
          label: t('X-WORK.cellAria', { char: e.char, state: stateWord(e) }),
          strokes: e.record ? sheetStrokes(store, e.record) : [],
          dot: e.dot ? dot(c, ink, INK_PAD) : null,
          cap: e.tag === 'afterSeen' ? t('X-WORK.afterSeen') : '',
        };
      }),
    };
  }
  const quiet = !!(work && work.empty);
  const glyph = ax ? ROW_GLYPH_AX : ROW_GLYPH;
  const rows = work
    ? work.rows.filter(r => r.state !== 'in' && r.state !== 'added').map(row => {
      const inked = row.state === 'addable';
      const wrongRow = !quiet && (row.state === 'addable' || (row.state === 'noInk' && row.judgment === 'wrong'));
      const ink = inked ? inkFor(row.record) : null;
      const cell = model.cells[row.index];
      return {
        index: row.index, char: row.char, recordId: row.recordId || null, kind: row.kind, state: row.state, judgment: row.judgment,
        text: rowText(row, quiet), tag: row.state === 'paper' ? t('X-DETAIL.paperTag') : '', label: rowAria(row, quiet),
        widthScale: inkWidthScale(glyph), mode: inked ? 'hand' : 'under', strokes: inked && row.record ? sheetStrokes(store, row.record) : [],
        dot: wrongRow ? dot(glyph, ink, ROW_PAD) : null,
        change: row.judgment === 'wrong' && !!(cell && cell.canChange),
        changeLabel: `${changeLabel()} ›`, // 写字页结果行同一个「修改 ›」（ChangeLink：字 + 4 + ›）
        add: inked, addAria: inked ? t('X-FIRST.addAria', { char: row.char }) : '',
      };
    })
    : [];
  const extras = firstExtras({ cells: model.cells, sched: state && state.sched, today: localDay(envNow()), work, variant: model.variant });
  const example = inviteExample(session);
  let inviteBody = { plain: t('X-INVITE.bodyPlain') };
  if (example) {
    const [pre, post] = t('X-INVITE.body', { word: '\u0001', pinyin: example.pinyin }).split('\u0001');
    inviteBody = { pre, post, word: Array.from(example.word), blanks: example.blanks };
  }
  const W = sw - 40;
  const lines = {
    title: textLineStarts(model.title, { wrapClass: 'sz-result__head', tag: 'h2', cls: 'sz-result__title sz-result__title--lead' }, W),
    sub: textLineStarts(model.sub.join(''), { wrapClass: 'sz-result__head', cls: 'sz-result__sub' }, W),
    preview: textLineStarts(extras ? extras.preview : '', { wrapClass: 'sz-result', cls: 'sz-result__preview' }, W),
    inviteBody: inviteLineStarts(inviteBody, W),
  };
  const wrongChars = model.cells.filter(c => c.kind === 'judged' && c.judgment === 'wrong').map(c => c.char);
  const remaining = undo && Number.isFinite(undo.until) ? Math.max(0, undo.until - clockNow()) : 0;
  return {
    found: model.found,
    slot,
    sessionId,
    variant: model.variant,
    early: model.early,
    header: model.header,
    title: model.title,
    sub: model.sub.join(''),
    day: model.day,
    work: workView,
    rows,
    quiet,
    lines,
    rowGlyph: glyph,
    rowPad: ROW_PAD,
    preview: extras ? extras.preview : '',
    share: !!model.share && typeof resultImageAction() === 'function',
    footer: {
      kind: model.variant === 'first' ? 'first' : model.again ? 'again' : 'leave',
      leave: model.leave.label,
      redo: wrongChars.length > 0,
    },
    invite: {
      show: !!session && inviteShouldShow(state, { variant: model.variant, sessionId: session.id }),
      title: t('X-INVITE.title'), titleEvening: t('X-INVITE.titleEvening'), body: inviteBody,
    },
    reveal: {
      sealed: !!(session && Number.isFinite(session.sealedAt)),
      plan: revealPlan(work && !work.empty ? work.cells.length : 1),
    },
    undo: undo && remaining > 0 ? { char: undo.char || '', recordId: undo.recordId, sessionId: undo.sessionId, remainingMs: remaining, strokes: undo.strokes || null } : null,
  };
}
