// 写字页题面（M1-8；决定-D16 / R-W28；01-架构设计 §6.8）。
//
// 题面 = 词语行 + 提示行：
// - 词语按码点逐格渲染（core/cards.js promptModel 的 segments，与内容门禁共用同一实现）：
//   原目标位（blank）只显示拼音（格上方）+ 红框虚线十字；词里其余同一目标字位（repeatBlank）一律「□」，
//   role=img + aria-label「同一目标字的另一处空格」；其余字原样显示。
// - 提示行 = promptModel.visibleHint（释义 / 语境线索 / 仅拼音题说明 + 重复目标字说明 R-W28），aria-live=polite；
//   题面容器 role=group、aria-describedby 指向提示行（沿 #175 #prompt/#hint 语义）。
// - 全部文字用 Preact 文本子节点写入（= textContent，不走 innerHTML）：题库或自定义文本里的 `<img onerror>` 只是字面量。
// - 回忆阶段答案字不进任何文本、aria / title / data 属性（D16）；本组件只在 REVEAL_PHASES（对照 / 看答案 / 描一遍，
//   与原型 ShiziWriteScreen L527 `revealed` 同一集合）把目标字填进空格——判断页的揭示动效由 M1-5 接。
// - 文案：PROMPT_COPY 的五项全部从 src/config/copy/ 取（promptCopy()），值与 cards.js 默认值逐字一致
//   （test/ui/prompt.test.mjs 断言），所以门禁 promptHTML / visibleHint 与界面字节一致。
//
// 版式（原型 ShiziWriteScreen L45–L60 标准版 / L175–L181 紧凑版）：拼音 15px（单字题 22px）在空格正上方；
// 每格 56×54、楷体 34px、--g 细边、--c 底；空格 inset 1.5px --ar 红框 + 虚线十字；空格尽量水平居中
// （原型 rowLeft = 168.5 − blank×56），放不下时整行贴边；字号随 --k（大字 1.3）；格宽不够时等比收窄不裁切。
//
// data-testid：write-prompt（容器）、write-prompt-word（词语行）、write-prompt-cell（每格，data-kind=text|blank|repeatBlank）、
// write-prompt-py（原目标位拼音）、write-prompt-hint（提示行）。

import { html, useRef } from '../../../../vendor/ui.js';
import { promptModel } from '../../../core/cards.js';
import { cardForKey, withWordOff } from '../../../data/deck.js';
import { getStore } from '../../../store/store.js';
import { injectStyles, T } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';

/** 这些阶段题面把目标字填回空格（原型 L527）；recall / retrace 一律遮住。 */
export const REVEAL_PHASES = Object.freeze(['compare', 'answer', 'trace']);

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

/**
 * 题面格与提示行（纯函数，node:test 可测）。
 * @returns {{cells: Array<{kind:'text'|'blank'|'repeatBlank', text:string, label:string|null, fill:string|null}>,
 *            hint:string, blankIndex:number, count:number}}
 *   text：该格可见文字（blank 为拼音；repeatBlank 为 □，揭示后为目标字）；fill：揭示时 blank 格里的目标字。
 */
export function promptCells(card, { revealed = false, copy = promptCopy() } = {}) {
  if (!card || !Array.isArray(card.chars)) return { cells: [], hint: '', blankIndex: -1, count: 0 };
  const model = promptModel(card, copy);
  const cells = model.segments.map(seg => {
    if (seg.kind === 'blank') return { kind: 'blank', text: seg.text, label: null, fill: revealed ? card.target : null };
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
.sz-prompt{align-self:stretch;min-width:0;display:flex;flex-direction:column;align-items:stretch}
.sz-prompt__wordwrap{box-sizing:border-box;width:100%;padding-top:calc(26px * ${T.k})}
.sz-prompt[data-single="true"] .sz-prompt__wordwrap{padding-top:calc(32px * ${T.k})}
.sz-prompt__word{--cw:calc(56px * ${T.k});box-sizing:border-box;display:flex;width:max-content;max-width:100%;
  margin-left:max(0px, min(calc(50% - (var(--bi) + .5) * var(--cw)), calc(100% - var(--n) * var(--cw))));
  border:1px solid var(--g, rgba(166,83,63,.28));border-left:0;background:${T.c}}
.sz-prompt__cell{position:relative;box-sizing:border-box;flex:0 1 auto;width:var(--cw);min-width:0;height:calc(54px * ${T.k});
  border-left:1px solid var(--g, rgba(166,83,63,.28));font-family:var(--kai, serif);font-size:calc(34px * ${T.k});
  line-height:calc(54px * ${T.k});text-align:center;color:${T.i1};white-space:nowrap}
.sz-prompt__cell[data-kind="blank"]{box-shadow:inset 0 0 0 1.5px ${T.ar}}
.sz-prompt__cell[data-kind="repeatBlank"][data-masked="true"]{font-family:${T.sans};font-size:calc(28px * ${T.k});color:${T.i3}}
.sz-prompt__py{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);padding-bottom:calc(4px * ${T.k});
  font-family:${T.sans};font-size:calc(15px * ${T.k});line-height:calc(22px * ${T.k});letter-spacing:0;color:${T.i2};
  white-space:nowrap}
.sz-prompt[data-single="true"] .sz-prompt__py{font-size:calc(22px * ${T.k});line-height:calc(28px * ${T.k});color:${T.i1}}
.sz-prompt__cross{position:absolute;inset:0;pointer-events:none}
.sz-prompt__cross::before{content:"";position:absolute;left:50%;top:9px;bottom:9px;border-left:1px dashed var(--g, rgba(166,83,63,.28))}
.sz-prompt__cross::after{content:"";position:absolute;top:50%;left:9px;right:9px;border-top:1px dashed var(--g, rgba(166,83,63,.28))}
.sz-prompt__fill{display:block}
.sz-prompt__hint{margin:10px 0 0;min-width:0;text-align:center;font-size:calc(14px * ${T.k});line-height:1.6;
  letter-spacing:.02em;color:${T.i2};white-space:normal;overflow-wrap:anywhere}
.sz-prompt__hint:empty{margin:0}
`);

function Cell({ cell }) {
  if (cell.kind === 'blank') {
    return html`<span class="sz-prompt__cell" data-kind="blank" data-testid="write-prompt-cell"><span
      class="sz-prompt__py" data-testid="write-prompt-py">${cell.text}</span>${cell.fill
      ? html`<span class="sz-prompt__fill">${cell.fill}</span>`
      : html`<span class="sz-prompt__cross" aria-hidden="true"></span>`}</span>`;
  }
  if (cell.kind === 'repeatBlank' && cell.label) {
    return html`<span class="sz-prompt__cell" data-kind="repeatBlank" data-masked="true" data-testid="write-prompt-cell"
      role="img" aria-label=${cell.label}>${cell.text}</span>`;
  }
  return html`<span class="sz-prompt__cell" data-kind=${cell.kind} data-testid="write-prompt-cell">${cell.text}</span>`;
}

/**
 * 纯视图（无 hooks，node:test 可直接调用后遍历 vnode 树检查属性）。
 * @param {{model: ReturnType<typeof promptCells>, hintId: string, groupLabel: string, testid?: string}} props
 */
export function PromptView({ model, hintId, groupLabel, testid = 'write-prompt' }) {
  const { cells, hint, blankIndex, count } = model;
  const vars = `--n:${Math.max(count, 1)};--bi:${Math.max(blankIndex, 0)}`;
  return html`<div class="sz-write__prompt sz-prompt" role="group" aria-label=${groupLabel} aria-describedby=${hintId}
    data-testid=${testid} data-single=${count === 1 ? 'true' : 'false'}>
    <div class="sz-prompt__wordwrap">
      <div class="sz-prompt__word" data-testid="write-prompt-word" style=${vars}>
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
 * @param {{cardKey?: string, card?: object, phase?: string, testid?: string}} props
 *   card 直接给卡片时不查题库（紧凑版 / 演示）；phase ∈ REVEAL_PHASES 时把目标字填回空格。
 */
export function Prompt({ cardKey, card, phase = 'recall', testid = 'write-prompt' }) {
  const idRef = useRef(null);
  if (!idRef.current) {
    hintSeq += 1;
    idRef.current = `sz-prompt-hint-${hintSeq}`;
  }
  // M3-6：单字详情「换掉这个词语」（wordOff）生效后题面改只按拼音写（data/deck.js withWordOff）。
  const resolved = card || withWordOff(cardForKey(cardKey), wordOffTable());
  const model = promptCells(resolved, { revealed: REVEAL_PHASES.includes(phase) });
  return html`<${PromptView} model=${model} hintId=${idRef.current} groupLabel=${t('X-PROMPT.groupLabel')} testid=${testid} />`;
}
