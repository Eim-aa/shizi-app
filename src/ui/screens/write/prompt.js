// 写字页题面（M1-8；决定-D16 / R-W28；01-架构设计 §6.8）。
//
// 题面 = 词语行 + 提示行：
// - 词语按码点逐格渲染（core/cards.js promptModel 的 segments，与内容门禁共用同一实现）：
//   原目标位（blank）只显示拼音（格上方）+ 一个空框（D49：不画十字）；词里其余同一目标字位（repeatBlank）一律「□」（同样的空框），
//   role=img + aria-label「同一目标字的另一处空格」；其余字原样显示、不装框。
// - 提示行 = promptModel.visibleHint（释义 / 语境线索 / 仅拼音题说明 + 重复目标字说明 R-W28），aria-live=polite；
//   题面容器 role=group、aria-describedby 指向提示行（沿 #175 #prompt/#hint 语义）。
// - 全部文字用 Preact 文本子节点写入（= textContent，不走 innerHTML）：题库或自定义文本里的 `<img onerror>` 只是字面量。
// - 回忆阶段答案字不进任何文本、aria / title / data 属性（D16）；本组件只在 REVEAL_PHASES（看答案 / 描一遍）把目标字填进空格；
//   D49 起判断页（compare）也不填：目标格仍是空框，答案只在下面的参考格出现一次。
// - 文案：PROMPT_COPY 的五项全部从 src/config/copy/ 取（promptCopy()），值与 cards.js 默认值逐字一致
//   （test/ui/prompt.test.mjs 断言），所以门禁 promptHTML / visibleHint 与界面字节一致。
//
// 版式（D49 实现交接 §13.1，取代原型 L45–L60）：整词水平居中（与书写格同一条中轴）；每格 52 见方（AX 档 52 × min(--k, 1.6)，P225；拼音、提示行封顶 17pt），已给的字只画字（格内 80%）、不装框；
// 要写的格只画 frameW frame 的空框；拼音 t15 ink2 注在要写的格正上方（拼音行高 ≥ 24、与格间 4，各列底对齐）。402 标准字号下整个题面高 80（28 + 52）；
// 提示行（释义 / 语境线索 / 重复目标字说明）只在有内容时出现，题面随之变高（写字页按量到的题面高算书写格组的位置）。格宽不够时等比收窄不裁切。
//
// data-testid：write-prompt（容器）、write-prompt-word（词语行）、write-prompt-cell（每格，data-kind=text|blank|repeatBlank）、
// write-prompt-py（原目标位拼音）、write-prompt-hint（提示行）。

import { html, useRef } from '../../../../vendor/ui.js';
import { promptModel } from '../../../core/cards.js';
import { capitalCard, cardForKey, withWordOff } from '../../../data/deck.js';
import { getStore } from '../../../store/store.js';
import { injectStyles, T } from '../../components/styles.js';
import { PracticeGlyph, FACE_FULL } from '../../components/PracticeGlyph.js';
import { t } from '../../../config/copy/index.js';
import * as policy from '../../../config/policy.js';

const AX_SCALE_MAX = policy.writeGrid.axPromptScaleMax;

/** 这些阶段题面把目标字填回空格（原型 L527）；recall / retrace 一律遮住。D49：判断页（compare）的目标格也不显示答案，答案只在参考格出现一次。 */
export const REVEAL_PHASES = Object.freeze(['answer', 'trace']);

let copyCache = null;
/** cards.js PROMPT_COPY 的同形对象，值取自 src/config/copy/（R-W28、X-PROMPT）。 */
export function promptCopy() {
  if (!copyCache) {
    copyCache = Object.freeze({
      repeatInstruction: t('R-W28.repeatBlankNote'),
      fallbackHint: t('X-PROMPT.fallbackHint'),
      repeatBlankLabel: t('X-PROMPT.repeatBlankLabel'),
      missingPinyin: t('X-PROMPT.missingPinyin'),
      repeatBlankGlyph: t('X-PROMPT.repeatBlankGlyph'),
    });
  }
  return copyCache;
}

// ---- 卡片查找 ----------------------------------------------------------------------------------------------
// M2-2：题库访问收回到 src/data/deck.js（loadDeck / cardForKey）；这里只转出，保持 M1-8 的导入路径可用
// （e2e m1-prompt-mask 经本模块 setCardResolver 注入合成卡，与 deck.js 共用同一个 resolver）。

export { cardForKey, setCardResolver, indexCards } from '../../../data/deck.js';

// ---- 纯模型 ------------------------------------------------------------------------------------------------

const TONE_MARKS = Object.freeze({ '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 });

/** 拼音声调（1–4；没有声调符号 = 5 轻声）：zhāng → 1，gān → 1，tì → 4，ma → 5。 */
export function toneOfPinyin(py) {
  for (const ch of String(py || '').normalize('NFD')) {
    if (Object.prototype.hasOwnProperty.call(TONE_MARKS, ch)) return TONE_MARKS[ch];
  }
  return 5;
}

/**
 * 回忆阶段空格（要写的字）的读屏名称：「要写的字，第 1 个，读 gān，一声」（A9；单字题不报位置）。
 * 只由位置、拼音、声调决定，不含答案字（D16）。揭示阶段（判断 / 看答案 / 描一遍）格里是答案字的文本，
 * 不设 role=img / 名称（会把字藏起来），读屏顺着文本读「拼音、字」。拼音缺失（占位「？」）时也不给名称。
 */
export function blankLabel({ py, index, count }) {
  const pinyin = String(py || '').trim();
  if (!pinyin) return null;
  return t(count > 1 ? 'X-PROMPT.blankLabel' : 'X-PROMPT.blankLabelSingle', { n: index + 1, pinyin, tone: t(`X-PROMPT.tone${toneOfPinyin(pinyin)}`) });
}

/**
 * 题面格与提示行（纯函数，node:test 可测）。
 * @returns {{cells: Array<{kind:'text'|'blank'|'repeatBlank', text:string, label:string|null, fill:string|null}>,
 *            hint:string, blankIndex:number, count:number}}
 *   text：该格可见文字（blank 为拼音；repeatBlank 为 □，揭示后为目标字）；fill：揭示时 blank 格里的目标字。
 */
export function promptCells(card, { revealed = false, copy = promptCopy() } = {}) {
  if (!card || !Array.isArray(card.chars)) return { cells: [], hint: '', blankIndex: -1, count: 0 };
  const model = promptModel(card, copy);
  const cells = model.segments.map((seg, i) => {
    if (seg.kind === 'blank') {
      return { kind: 'blank', text: seg.text, label: revealed ? null : blankLabel({ py: card.py, index: i, count: card.chars.length }), fill: revealed ? card.target : null };
    }
    if (seg.kind === 'repeatBlank') {
      return revealed
        ? { kind: 'repeatBlank', text: card.target, label: null, fill: null }
        : { kind: 'repeatBlank', text: seg.text, label: seg.label, fill: null };
    }
    return { kind: 'text', text: seg.text, label: null, fill: null };
  });
  const blankIndex = cells.findIndex(c => c.kind === 'blank');
  return { cells, hint: model.visibleHint, blankIndex, count: cells.length };
}

// ---- 视图 --------------------------------------------------------------------------------------------------

injectStyles('write-prompt', `
.sz-prompt{--cw:52px;align-self:stretch;min-width:0;display:flex;flex-direction:column;align-items:stretch}
:root[data-ax] .sz-prompt{--cw:calc(52px * min(var(--k), ${AX_SCALE_MAX}))}
.sz-prompt__wordwrap{box-sizing:border-box;width:100%;display:flex;justify-content:center;padding-top:calc(max(24px, ${T.lh15}) + 4px)}
.sz-prompt__word{display:flex;width:max-content;max-width:100%}
.sz-prompt__cell{position:relative;box-sizing:border-box;flex:0 1 auto;width:var(--cw);min-width:0;aspect-ratio:1/1;text-align:center;
  color:${T.ink1};white-space:nowrap}
/* 练习字统一用轮廓（P1-E2）：已给的字只画字、不装框，字面占格 80%（实现交接 §13.1）；格比 52 窄时随格收窄 */
.sz-prompt__cell>.sz-pg{position:absolute;left:50%;top:50%;width:80%;height:auto;aspect-ratio:1/1;
  transform:translate(-50%,-50%);color:${T.ink1}}
/* 只有要写的格（原目标位、同一目标字的另一处空格）画框：frameW frame，格内空白，不画十字（D49：框只表示「在这里写」） */
.sz-prompt__cell[data-kind="blank"],.sz-prompt__cell[data-kind="repeatBlank"][data-masked="true"]{box-shadow:inset 0 0 0 ${T.frameW} ${T.frame}}
.sz-prompt__cell[data-kind="repeatBlank"][data-masked="true"]{display:flex;align-items:center;justify-content:center;
  font-family:${T.hei};font-size:${T.fs28};line-height:1;color:${T.ink3}}
.sz-prompt__py{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);padding-bottom:4px;
  font-family:${T.hei};font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};
  white-space:nowrap}
.sz-prompt__hint{margin:10px 0 0;min-width:0;text-align:center;font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};white-space:normal;overflow-wrap:anywhere}
.sz-prompt__hint:empty{margin:0}
/* AX 档（D51 ⑦，P225；A2-04 / V2-06）：字永远最大——题面格随 min(--k, 1.6) 放大（52 → 83），拼音与提示行（辅助信息）封顶 17pt、不再随档放大（拼音原先 AX5 是 49px，比要回忆的字还大） */
:root[data-ax] .sz-prompt__wordwrap{padding-top:28px}
:root[data-ax] .sz-prompt__py{font-size:calc(17px * 1);line-height:24px}
:root[data-ax] .sz-prompt__hint{margin-top:8px;font-size:calc(17px * 1);line-height:24px}
`);

// 题面里的字：练习字轮廓（P1-E2）。方框就是那 40pt（FACE_FULL：1024 方框占满元素）。
const glyph = (char, cls) => html`<${PracticeGlyph} char=${char} face=${FACE_FULL} class=${cls} />`;

function Cell({ cell }) {
  if (cell.kind === 'blank') {
    return html`<span class="sz-prompt__cell" data-kind="blank" data-testid="write-prompt-cell"
      role=${cell.label ? 'img' : undefined} aria-label=${cell.label || undefined}><span
      class="sz-prompt__py" data-testid="write-prompt-py">${cell.text}</span>${cell.fill
      ? glyph(cell.fill, 'sz-prompt__fill')
      : null}</span>`;
  }
  if (cell.kind === 'repeatBlank' && cell.label) {
    return html`<span class="sz-prompt__cell" data-kind="repeatBlank" data-masked="true" data-testid="write-prompt-cell"
      role="img" aria-label=${cell.label}>${cell.text}</span>`;
  }
  return html`<span class="sz-prompt__cell" data-kind=${cell.kind} data-testid="write-prompt-cell">${glyph(cell.text)}</span>`;
}

/**
 * 纯视图（无 hooks，node:test 可直接调用后遍历 vnode 树检查属性）。
 * @param {{model: ReturnType<typeof promptCells>, hintId: string, groupLabel: string, testid?: string}} props
 */
export function PromptView({ model, hintId, groupLabel, testid = 'write-prompt' }) {
  const { cells, hint, count } = model;
  return html`<div class="sz-write__prompt sz-prompt" role="group" aria-label=${groupLabel} aria-describedby=${hintId}
    data-testid=${testid} data-single=${count === 1 ? 'true' : 'false'}>
    <div class="sz-prompt__wordwrap">
      <div class="sz-prompt__word" data-testid="write-prompt-word">
        ${cells.map((cell, i) => html`<${Cell} key=${i} cell=${cell} />`)}
      </div>
    </div>
    <p class="sz-prompt__hint" id=${hintId} aria-live="polite" data-testid="write-prompt-hint">${hint}</p>
  </div>`;
}

let hintSeq = 0;

function wordOffTable() {
  try {
    const state = getStore().getState();
    return state ? state.wordOff : null;
  } catch (error) {
    return null; // store 未启动（node:test / 演示）：没有换掉的词语
  }
}

/**
 * 写字页题面。
 * @param {{cardKey?: string, card?: object, queue?: string[], phase?: string, testid?: string}} props
 *   card 直接给卡片时不查题库（紧凑版 / 演示）；phase ∈ REVEAL_PHASES 时把目标字填回空格；
 *   queue = 当前会话队列：整组都是大写数字字（D40 特别组）时题面用借条 / 报销单语境（data/deck.js capitalCard）。
 */
export function Prompt({ cardKey, card, queue, phase = 'recall', testid = 'write-prompt' }) {
  const idRef = useRef(null);
  if (!idRef.current) {
    hintSeq += 1;
    idRef.current = `sz-prompt-hint-${hintSeq}`;
  }
  // M3-6：单字详情「换掉这个词语」（wordOff）生效后题面改只按拼音写（data/deck.js withWordOff）。
  const resolved = card || withWordOff(capitalCard(cardForKey(cardKey), queue), wordOffTable());
  const model = promptCells(resolved, { revealed: REVEAL_PHASES.includes(phase) });
  return html`<${PromptView} model=${model} hintId=${idRef.current} groupLabel=${t('X-PROMPT.groupLabel')} testid=${testid} />`;
}
