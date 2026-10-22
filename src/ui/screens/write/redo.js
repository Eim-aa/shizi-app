// 重写错字（D66 ③；P2-03、P1 遗漏）：一组写完后，把本组写错的字再写一遍。
//
// 入口：结果页底栏的文字按钮「重写错字」（本组有写错的字才显示），一次点击推入本页（普通推入，D62：非首页入口）；写完最后一个字点「完成」回到结果页（nav.back）。
// 只算练习：不写判断记录、不动调度、不存笔迹、不进字库三档——所以本页**完全不碰 store**（没有 commit，也不读会话）。
//   口径与「看过答案后凭记忆写」一致（R-W07.selfNote「再写只算练习」）：那一次的笔迹只是这一字的现场，推进时丢弃；区别是凭记忆写的笔迹会挂在 answer-seen 记录上，
//   而这里没有可挂的记录，宁可不记（不为练习新增一类记录，备份 / 字帖 / 年报的数字都不用解释）。
// 流程（每个字两步，版式与写字页同一套：write/compact.js useWriteLayout、foot.js WriteFoot、InkGrid，页面样式 write/index.js 的 W 选择器同时认本页）：
//   写：题面（词语 + 拼音，答案字不出现）→ 凭记忆写 → 主按钮「写好了」（没落笔时不可点）；求助行「看答案」直接去对照。
//   对照：上「你的书写」下「参考字形」（同判断页的 CompareStage，没有任何判断键）→ 主按钮「下一个」（最后一个字是「完成」）；求助行「再写一次」回到空书写格重写这个字。
// 页头：左上「‹」整页离开（左缘右滑同义）、中间「n / 总数」。
//
// 规则：文案只取 copy/；不写存储。
//
// data-testid：redo-screen（data-stage = write | check、data-index、data-total）、redo-done（写好了）、redo-show-answer（看答案）、redo-next（下一个 / 完成）、redo-again（再写一次）、
//   redo-undo / redo-clear（格下撤销 / 清空）、redo-note（格下说明）；书写格 write-grid、题面 write-prompt、对照 write-compare 与写字页同名。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { registerScreen, nav } from '../../router.js';
import { Page } from '../../components/Page.js';
import { Button, markStateChange } from '../../components/Button.js';
import { Icons } from '../../components/icons.js';
import { InkGrid } from '../../canvas/ink-canvas.js';
import { t } from '../../../config/copy/index.js';
import { redoCharsOf, redoQueueOf } from '../../../session/write-ops.js';
import { useStrokeData } from './hint-layer.js';
import { Prompt } from './prompt.js';
import { CompareStage } from './compare.js';
import { pyOf } from './ref-label.js';
import { LinkButton, Slot, WriteFoot } from './foot.js';
import { useAxLevel, useCompact, useFootHairline, useWriteLayout } from './compact.js';
import { gridLabel } from './sr-live.js';
import { AX_GRID_MIN } from './layout.js';
import { PEN_ARM_MS } from './index.js'; // 换字后书写格的落笔门限，与写字页同一个值
import { NativeRedoHost, nativeWriteEnabled } from './native-session.js';

export const REDO_SCREEN = 'redo';
const EMPTY = Object.freeze([]);

// 字表整理挪到无 DOM 的会话层（B2.9a，原生重写错字页的 redoOpen / redoNext 用同一个函数）；这里原名转出。
export { redoCharsOf, redoQueueOf };

/** 打开重写错字页（普通推入）。chars 为空时不打开。 */
export function openRedo(chars) {
  const list = redoCharsOf({ chars });
  if (!list.length) return false;
  nav.push(REDO_SCREEN, { chars: list });
  return true;
}

function clockNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function WebRedoScreen({ params }) {
  const chars = redoCharsOf(params);
  const total = chars.length;
  const queue = redoQueueOf(chars);
  const [st, setSt] = useState({ i: 0, stage: 'write', strokes: EMPTY, cleared: null });
  const i = Math.min(st.i, Math.max(0, total - 1));
  const cardKey = queue[i] || null;
  const char = chars[i] || '';
  const check = st.stage === 'check';
  const hasStrokes = st.strokes.length > 0;
  const strokeData = useStrokeData(char);

  // 没有能练的字（参数坏了 / 题库里没有）：不留空页，退回去
  useEffect(() => {
    if (!total) nav.back();
  }, [total]);

  const armRef = useRef({ key: undefined, until: 0 });
  if (armRef.current.key !== cardKey) armRef.current = { key: cardKey, until: clockNow() + PEN_ARM_MS };

  const compact = useCompact();
  const ax = useAxLevel();
  const writeRef = useRef(null);
  const layout = useWriteLayout(writeRef, { phase: check ? 'compare' : 'recall', ax, noteKey: cardKey ? `${cardKey}|${st.stage}` : null });
  useFootHairline(writeRef);
  useLayoutEffect(() => {
    markStateChange(); // 换字 / 换阶段算新状态：按钮 0.4s 不响应（走查-W08）
  }, [cardKey, st.stage]);

  if (!cardKey) return html`<${Page} title=${t('X-REDO.title')} testid="redo-screen"><div data-testid="redo-empty"></div></${Page}>`;

  const gridSize = layout.g;
  const pfit = layout.promptScale || 1;
  const groupTop = check ? layout.pair.top : layout.top;
  const last = i === total - 1;

  const onStrokeEnd = raw => setSt(prev => ({ ...prev, strokes: prev.strokes.concat([raw]), cleared: null }));
  const onUndo = () => setSt(prev => {
    if (prev.strokes.length) return { ...prev, strokes: prev.strokes.slice(0, -1) };
    if (prev.cleared) return { ...prev, strokes: prev.cleared, cleared: null };
    return prev;
  });
  const onClear = () => setSt(prev => (prev.strokes.length ? { ...prev, strokes: EMPTY, cleared: prev.strokes } : prev));
  const toCheck = () => setSt(prev => ({ ...prev, stage: 'check', cleared: null }));
  const again = () => setSt(prev => ({ ...prev, stage: 'write', strokes: EMPTY, cleared: null }));
  const next = () => {
    if (last) {
      nav.back(); // 回到结果页
      return;
    }
    setSt(prev => ({ i: prev.i + 1, stage: 'write', strokes: EMPTY, cleared: null }));
  };

  const progress = html`<span class="sz-write__progress" data-testid="redo-progress" role="img"
    aria-label=${t('R-W01.progressLabel', { n: i + 1, total })}>${t('R-W01.progress', { n: i + 1, total })}</span>`;
  const canUndo = hasStrokes || !!st.cleared;
  const toolRow = html`<div class="sz-write__tools" data-testid="redo-tools" data-shown=${check ? 'false' : 'true'} style=${{ width: `${gridSize}px` }}>
    <${Button} variant="plain" class="sz-write__tool" data-testid="redo-undo" aria-label=${t('R-W18.btnUndo')} disabled=${!canUndo} rapid
      onClick=${onUndo}>${Icons.undo()}<span>${t('R-W18.btnUndo')}</span></${Button}>
    <${Button} variant="plain" class="sz-write__tool" data-testid="redo-clear" aria-label=${t('R-W18.btnClear')} disabled=${!hasStrokes} rapid
      onClick=${onClear}>${Icons.clear()}<span>${t('R-W18.btnClear')}</span></${Button}>
  </div>`;
  const footer = check
    ? html`<${WriteFoot} primary=${{ testid: 'redo-next', label: last ? t('X-RESULT.done') : t('R-W07.btnNext'), onClick: next }} testid="redo-foot" stage="compare"
        left=${html`<${Slot} testid="redo-again-slot"><${LinkButton} testid="redo-again" label=${t('X-REDO.again')} onClick=${again} /></${Slot}>`} />`
    : html`<${WriteFoot} primary=${{ testid: 'redo-done', label: t('R-W29.btnDone'), disabled: !hasStrokes, onClick: toCheck }} testid="redo-foot" stage="recall"
        left=${html`<${Slot} testid="redo-answer-slot"><${LinkButton} testid="redo-show-answer" label=${t('R-W07.btnShowAnswer')} onClick=${toCheck} /></${Slot}>`} />`;

  return html`<${Page} title=${t('X-REDO.title')} hideTitle=${true} center=${progress} footer=${footer} testid="redo-screen">
    <div class="sz-write" ref=${writeRef} data-phase=${check ? 'compare' : 'recall'} data-stage=${check ? 'check' : 'write'} data-index=${i} data-total=${total} data-grid=${gridSize}
      data-compact=${compact ? 'true' : 'false'} data-ax=${ax > 0 ? String(ax) : null} data-pfit=${pfit < 1 ? String(pfit) : null} data-gfit=${ax > 0 && gridSize < AX_GRID_MIN ? 'true' : null}
      style=${pfit < 1 ? { paddingTop: `${groupTop}px`, '--pfit': String(pfit), '--pfit-pull': `${-Math.round((1 - pfit) * layout.promptHeight * 10) / 10}px` } : { paddingTop: `${groupTop}px` }}>
      <${Prompt} cardKey=${cardKey} queue=${queue} phase=${check ? 'compare' : 'recall'} />
      <div class="sz-write__gridwrap">
        ${check
    ? html`<div class="sz-cmpstage"><${CompareStage} char=${char} py=${pyOf(cardKey)} strokes=${st.strokes} strokeData=${strokeData}
            size=${layout.pair.s || gridSize} layout=${layout.pair.layout} /></div>`
    : html`<${InkGrid} strokes=${st.strokes} onStrokeEnd=${onStrokeEnd} drawable=${true} acceptFrom=${armRef.current.until}
            resetKey=${`${cardKey}|${st.stage}`} size=${gridSize} label=${gridLabel(st.strokes.length)} />`}
      </div>
      ${check ? null : html`<div class="sz-write__below" data-has-note="true">
        ${toolRow}
        <span class="sz-write__note" data-testid="redo-note">${t('X-REDO.note')}</span>
      </div>`}
    </div>
  </${Page}>`;
}

/**
 * B2.9a：原生写字页开关打开时，重写错字页由原生页面显示（宿主 NativeRedoHost：透明、不画内容；原生页复用写字页的书写格与对照两格，
 * 经写字会话 API 的 redoOpen / redoNext / redoExit 取同一份字表与题面，同样不写任何东西）。开关关着时就是本页，行为不变。
 */
function RedoScreen({ params, entry }) {
  if (nativeWriteEnabled()) return html`<${NativeRedoHost} params=${params} entry=${entry} />`;
  return html`<${WebRedoScreen} params=${params} />`;
}

registerScreen(REDO_SCREEN, RedoScreen, { label: t('X-REDO.title'), nativeHost: () => nativeWriteEnabled() });
