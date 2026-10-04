// 结果页即作品（阶段 1 P1-E7；交接 §4 / §5；D31 / D46 ⑥ ⑩；首练结果页与日常结果页共用这一作品构图）。
// E9c（D49 减法修稿）：作品直接放在页面纸上（没有作品底板）；作品下的行只剩「字 + 状态 + 动作」，无框、无分隔线、用留白分组；
// 朱点在字的右上角（墨迹外框右上外 2pt）。
//
//   WorkSection   作品（作品格 + 落款与印 + 格下「看后写的」标注；落款出现时播一次盖章声，S1）；没有任何墨时换成衬底参考字一行 + 格下状态字（§4.2 变体）。
//   WorkRows      作品下「没放进图里」的行：36pt 字（有墨写本人墨，没墨写衬底）+ 状态词（写错了 / 看过答案 / 跳过了 / 写对 · 纸上…）+ 右侧「放进图里」
//                 （仅写错且有墨；纸上只有说明，D47）；点行 → 对照与修改（D19）。放进图里的字回到作品、这一行消失。
//   commitAdded   「放进图里」/ 从分享弹层拿出来：写进本组会话的 added（经 store.commit，刷新后仍在；核心规则在 core/images/work.js）。
//
// data-testid：work（作品；data-n / data-cols / data-rows / data-cell）、work-cell（data-index / data-char / data-mode / data-dot / data-state）、
//   work-cap、work-kuan、work-seal、work-dot；result-excluded、result-exrow（data-char / data-record / data-state / data-added）、result-exrow-open、
//   result-add（aria-pressed）；result-exrow 带 data-index（该字在本组里的序号，与作品格的 data-index 同一套）。
import { html, useEffect } from '../../../../vendor/ui.js';
import { Button } from '../../components/Button.js';
import { CellCanvas, PlainRow, WorkPaper, WrongDot, useAxSize, useScreenWidth } from '../../components/work.js';
import { injectStyles, T, TEX } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';
import { resultGrid } from '../../../core/images/layout.js';
import { toggleAdded } from '../../../core/images/work.js';
import { kuan } from '../../work-text.js';
import { keySound, warmSounds } from '../../../platform/sound.js';

export const WORK_LABELS = Object.freeze({ added: 'result:added' });

/** 作品下一行里字的边长（pt；AX 档 52，D49）与格内内边（字面约 88%，字是图，不随字号放大——AX 档单独取 52）。 */
export const ROW_GLYPH = 36;
export const ROW_GLYPH_AX = 52;
const ROW_PAD = 0.03;

injectStyles('result-work', `
.sz-exrows{display:flex;flex-direction:column;margin-top:28px}
.sz-exrow{display:flex;align-items:center;gap:4px;min-height:52px;box-sizing:border-box}
.sz-exrow__open{flex:1;min-width:0;min-height:52px;display:flex;align-items:center;gap:12px;padding:8px 0;margin:0;border:0;background:transparent;
  color:inherit;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
.sz-exrow__open:focus-visible{outline:2px solid ${T.ink1};outline-offset:-2px}
.sz-exrow__open[data-pressed]{background:${T.field}}
.sz-exrow__cell{position:relative;flex:none;width:${ROW_GLYPH}px;height:${ROW_GLYPH}px}
.sz-exrow__cell--ax{width:${ROW_GLYPH_AX}px;height:${ROW_GLYPH_AX}px}
.sz-exrow__cell canvas{position:absolute;left:0;top:0}
.sz-exrow__t{flex:1;min-width:0;font-size:${T.fs17};line-height:${T.lh17s};color:${T.ink2}}
.sz-exrow__tag{color:${T.ink3}}
.sz-exrow .sz-btn--text{flex:none}
:root[data-ax] .sz-exrow{flex-wrap:wrap;padding:6px 0}
:root[data-ax] .sz-exrow__open{flex:1 1 100%;min-height:${ROW_GLYPH_AX}px;padding:0}
:root[data-ax] .sz-exrow .sz-btn--text{margin-left:${ROW_GLYPH_AX + 12}px}
`);

// ---------------------------------------------------------------- 写入

const STALE = Object.freeze({ ok: false, error: Object.freeze({ kind: 'stale' }) });

function sessionsOf(state) {
  const s = state && state.sessions;
  return s ? { A: s.A || null, B: s.B || null, lastEnded: { ...(s.lastEnded || {}) } } : { A: null, B: null, lastEnded: {} };
}

/** 找本组会话在哪个槽、结束了没有（slot 缺省时按会话 id 找）。 */
export function locateSession(state, { slot = null, sessionId }) {
  const s = sessionsOf(state);
  const slots = slot ? [slot] : ['A', 'B'];
  for (const k of slots) if (s.lastEnded[k] && s.lastEnded[k].id === sessionId) return { slot: k, where: 'ended', session: s.lastEnded[k] };
  for (const k of slots) if (s[k] && s[k].id === sessionId) return { slot: k, where: 'slot', session: s[k] };
  return null;
}

/** 「放进去」/「拿出来」的 mutator 主体：只改本组会话的 added。on 缺省 = 切换。 */
export function setAddedInDraft(draft, { slot = null, sessionId, recordId, on }) {
  const found = locateSession(draft, { slot, sessionId });
  if (!found) throw new Error('added: session not found');
  const { session } = found;
  if (!session.items.some(it => it && it.recordId === recordId)) throw new Error('added: record is not in this session');
  const next = { ...session, added: toggleAdded(session, recordId, on) };
  const cur = sessionsOf(draft);
  if (found.where === 'ended') draft.sessions = { ...cur, lastEnded: { ...cur.lastEnded, [found.slot]: next } };
  else draft.sessions = { ...cur, [found.slot]: next };
  return next;
}

/** 「放进去」/「拿出来」一次 commit。会话已不在（离开了结果页）时 stale。 */
export function commitAdded(store, { slot = null, sessionId, recordId, on } = {}) {
  if (!locateSession(store.getState(), { slot, sessionId })) return STALE;
  return store.commit(WORK_LABELS.added, draft => {
    setAddedInDraft(draft, { slot, sessionId, recordId, on });
  });
}

// ---------------------------------------------------------------- 视图

function stateWord(entry) {
  if (entry.tag === 'afterSeen') return t('X-WORK.cellStateAfterSeen');
  return t(entry.judgment === 'wrong' ? 'X-WORK.cellStateWrong' : 'X-WORK.cellStateCorrect');
}

function judgmentWord(entry) {
  return t(entry.judgment === 'wrong' ? 'X-WORK.statusWrong' : 'X-WORK.statusCorrect');
}

/** 衬底一行（整组没有墨）格下的状态字：纸上那一字写「纸上」（D47，交接 §4.2 / §10.2）。 */
function statusWord(entry) {
  if (entry.state === 'paper') return t('X-WORK.statusPaper');
  if (entry.kind === 'skipped') return t('X-WORK.statusSkipped');
  if (entry.kind === 'answer-seen') return t('X-WORK.statusSeen');
  return judgmentWord(entry);
}

/** 衬底一行里一格的读屏状态：纸上「写对，纸上」（交接 §5.5），其余同格下状态字。 */
function cellStateOf(entry) {
  return entry.state === 'paper' ? t('X-WORK.paperState', { state: judgmentWord(entry) }) : statusWord(entry);
}

/** 整体读屏名称：「作品：疆、酱、酝，3 个字，10月5日」。 */
export function workAria(chars, n, date) {
  const joined = chars.join(t('X-WORK.charsJoin'));
  return n > 1 ? t('X-WORK.workAria', { chars: joined, n, date }) : t('X-WORK.workAriaOne', { chars: joined, date });
}

/**
 * 作品（或没有墨时的衬底一行）。
 * @param {{work:object, day:string|null, dateText:string, inkOf:(record)=>object|null, onOpen:(entry)=>void}} props
 *   work = core/images/work.js buildWork 的结果；inkOf(record) → {points, strokes}。
 */
export function WorkSection({ work, day, dateText, inkOf, onOpen, picked = false, sealKey = '', settings = null }) {
  const sw = useScreenWidth();
  // 落款盖章声（S1，D50 ⑦ / D46 ⑮）：结果页作品首次呈现落款时响一次（网页阶段没有落印动画，作品出现即落款）；同一组（sealKey）再渲染、
  // 回到本页不再响；没有墨（衬底一行、无落款）不响；settings.sound 关着完全无声。
  const hasSeal = !work.empty;
  useEffect(() => {
    if (!hasSeal) return;
    const play = () => keySound('seal', { settings, key: sealKey || 'work' });
    warmSounds({ settings, events: ['seal'] }).then(play, play);
  }, [hasSeal, sealKey]);
  if (work.empty) {
    const entries = work.entries;
    if (!entries.length) return null;
    const grid = resultGrid(entries.length, sw);
    const cells = entries.map(e => ({
      key: e.index, index: e.index, ch: e.char, status: statusWord(e), wrong: e.judgment === 'wrong' && e.kind === 'judged' && e.state !== 'paper',
      label: t('X-WORK.cellAria', { char: e.char, state: cellStateOf(e) }),
    }));
    return html`<${PlainRow} cells=${cells} grid=${grid} onOpen=${cell => onOpen(entries[cell.index])}
      label=${workAria(entries.map(e => e.char), entries.length, dateText)} />`;
  }
  const grid = resultGrid(work.cells.length, sw);
  const cells = work.cells.map(e => ({
    key: e.recordId || e.index, index: e.index, ch: e.char, ink: inkOf(e.record), mode: 'hand', dot: e.dot, record: e.recordId || '', state: e.state,
    label: t('X-WORK.cellAria', { char: e.char, state: stateWord(e) }),
  }));
  const caps = work.cells.map(e => (e.tag === 'afterSeen' ? t('X-WORK.afterSeen') : ''));
  return html`<${WorkPaper} cells=${cells} grid=${grid} caps=${caps} kuan=${kuan({ day, n: cells.length, picked })}
    onOpen=${cell => onOpen(work.entries[cell.index])} label=${workAria(work.cells.map(e => e.char), work.cells.length, dateText)} />`;
}

function rowText(entry) {
  switch (entry.state) {
    case 'addable':
    case 'added':
      return t('X-FIRST.excluded');
    case 'noInk':
      return t(entry.judgment === 'wrong' ? 'X-WORK.rowNoInkWrong' : 'X-WORK.rowNoInkCorrect');
    case 'seen':
      return t('X-WORK.rowSeen');
    case 'skipped':
      return t('X-WORK.rowSkipped');
    default:
      // 纸上：「写对」，后面单独接墨三的「· 纸上」（rowTag）
      return t(entry.judgment === 'wrong' ? 'X-WORK.rowPaperWrong' : 'X-WORK.rowPaperCorrect');
  }
}

/** 纸上行的读屏名称：「{字}，写对，纸上」（交接 §5.5）；其余行读「{字}，{状态}」，字在文字里已经没有了（D49）。 */
function rowAria(entry) {
  if (entry.state === 'paper') return t('X-WORK.rowPaperAria', { char: entry.char, state: judgmentWord(entry) });
  return t('X-WORK.rowAria', { char: entry.char, state: rowText(entry) });
}

/**
 * 作品下没放进图里的行（已放进图里的字回到作品，不再有行）。
 * @param {{rows:Array, inkOf:(record)=>object|null, onOpen:(entry)=>void, onToggle:(entry)=>void}} props
 */
export function WorkRows({ rows, inkOf, onOpen, onToggle }) {
  const ax = useAxSize();
  const shown = (rows || []).filter(row => row.state !== 'added');
  if (!shown.length) return null;
  const size = ax ? ROW_GLYPH_AX : ROW_GLYPH;
  return html`<div class="sz-exrows" data-testid="result-excluded">${shown.map(row => {
    const inked = row.state === 'addable';
    // 写错的字（有墨可放进图里的、或写错但没留墨迹的）在字的右上带朱点；纸上行没有墨、不带
    const wrongRow = row.state === 'addable' || (row.state === 'noInk' && row.judgment === 'wrong');
    const ink = inked ? inkOf(row.record) : null;
    return html`<div key=${row.index} class="sz-exrow" data-testid="result-exrow" data-index=${row.index} data-char=${row.char} data-record=${row.recordId || ''}
      data-state=${row.state}>
      <button type="button" class="sz-exrow__open" data-testid="result-exrow-open" aria-label=${rowAria(row)} onClick=${() => onOpen(row)}>
        <span class=${ax ? 'sz-exrow__cell sz-exrow__cell--ax' : 'sz-exrow__cell'} data-testid="result-exrow-glyph" aria-hidden="true">
          <${CellCanvas} ch=${row.char} ink=${ink} mode=${inked ? 'hand' : 'under'} size=${size} pad=${ROW_PAD} testid="result-exrow-canvas" />
          ${wrongRow ? html`<${WrongDot} size=${size} ink=${ink} pad=${ROW_PAD} testid="result-exrow-dot" />` : null}
        </span>
        <span class="sz-exrow__t" data-testid="result-exrow-text">${rowText(row)}${row.state === 'paper'
          ? html` <span class="sz-exrow__tag" data-testid="result-exrow-tag">${t('X-DETAIL.paperTag')}</span>`
          : null}</span>
      </button>
      ${inked
        ? html`<${Button} variant="text" data-testid="result-add"
            aria-label=${t('X-FIRST.addAria', { char: row.char })}
            onClick=${() => onToggle(row)}>${t('X-FIRST.addIn')}</${Button}>`
        : null}
    </div>`;
  })}</div>`;
}
