// 写字页的读屏播报（R2-A1，第二轮审查 A2-06；03 P231）：书写格的读屏名称带当前笔数，抬笔后经一个 aria-live=polite 区域播报；
// 提示、描一遍出现时播报给出了哪几笔。
//
// 规则：
// - 只在「状态变化」时播报：笔数变了（抬笔 / 撤销 / 清空 / 撤销恢复）、提示新给出一次、进入描一遍。不在每次 pointermove 播报（书写格不在移动中写任何文字）。
// - 换字 / 换阶段（key 变）只重置基线，不播报；恢复现场（刷新后已有笔画）同理。
// - 笔画名称：数据里没有笔画类型（横竖撇捺…，阶段 2 原生书写面补），所以一律读「第 n 笔」。
// - 同一句话连续出现两次（撤销一笔再写一笔，笔数相同）要让读屏再读一遍：交替追加一个零宽空格。
import { html, useEffect, useRef, useState } from '../../../../vendor/ui.js';
import { injectStyles } from '../../components/styles.js';
import { t } from '../../../config/copy/index.js';

injectStyles('write-sr-live', `
.sz-write__sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
`);

/** 书写格的读屏名称：没写时「书写格」，写了「书写格，已写 3 笔」。 */
export function gridLabel(strokeCount) {
  const n = Math.max(0, Math.trunc(Number(strokeCount) || 0));
  return n > 0 ? t('X-WRITE.gridLabelCount', { n }) : t('X-WRITE.gridLabel');
}

/** 笔数变化 → 播报句（没变化返回 ''）。 */
export function strokeAnnouncement(prev, next) {
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev === next) return '';
  if (next > prev) return next - prev === 1 ? t('X-WRITE.liveStroke', { n: next }) : t('X-WRITE.liveRestored', { n: next });
  if (next === 0) return prev === 1 ? t('X-WRITE.liveUndoEmpty') : t('X-WRITE.liveCleared');
  return t('X-WRITE.liveUndo', { n: next });
}

// B2.2：提示播报的两句（strokeRangeText / hintAnnouncement）挪到无 DOM 的 src/session/ops/hint.js（写字会话 API 的 hint op 同一句），这里原名转出。
import { strokeRangeText, hintAnnouncement } from '../../../session/write-ops.js';
export { strokeRangeText, hintAnnouncement };

/** 进入描一遍：参考字形画出了全部 total 笔。没有笔顺数据（楷体整字）时只说出现了参考字形。 */
export function traceAnnouncement(total) {
  const n = Math.trunc(Number(total)) || 0;
  if (n <= 0) return t('X-WRITE.liveTraceWhole');
  return t('X-WRITE.liveTrace', { range: strokeRangeText(0, n) });
}

/**
 * 写字页的播报：返回 {node, message}。node 是视觉隐藏的 aria-live=polite 区域（一直挂着，文字变了读屏才会读）。
 * @param {object} o
 * @param {string|null} o.key  换字 / 换阶段的键（cardKey|phase），变了只重置基线（进入描一遍除外，见 trace）
 * @param {number} o.strokeCount  书写格笔数
 * @param {boolean} o.drawable  书写格是否可写（只有可写时才播报笔数）
 * @param {{run:number, range:{from:number,to:number}|null}|null} o.hintView  提示视图（run 每给一次提示 +1；恢复现场的不算）
 * @param {{active:boolean, status:'loading'|'ready'|'missing', total:number}} o.trace  描一遍：active = 正处在描一遍阶段
 */
export function useWriteAnnounce({ key, strokeCount, drawable, hintView, trace }) {
  const [message, setMessage] = useState('');
  const flip = useRef(false);
  const hintRun = hintView ? hintView.run : 0;
  const prev = useRef({ key, count: strokeCount, run: hintRun, traced: null });
  const say = text => {
    if (!text) return;
    flip.current = !flip.current;
    setMessage(flip.current ? text : `${text}\u200b`);
  };

  useEffect(() => {
    const p = prev.current;
    if (p.key !== key) {
      prev.current = { key, count: strokeCount, run: hintRun, traced: null };
      setMessage(''); // 换字 / 换阶段：上一句播报作废（读屏树里不留过期的话）
      return;
    }
    let text = '';
    if (strokeCount !== p.count && drawable) text = strokeAnnouncement(p.count, strokeCount);
    if (hintRun > p.run && hintView && hintView.range) text = hintAnnouncement(hintView.range);
    p.count = strokeCount;
    p.run = hintRun;
    say(text);
  }, [key, strokeCount, hintRun]);

  // 描一遍出现：参考字形（笔顺数据）就绪后读一次「画出了第 1 到第 n 笔」；数据取不到（楷体整字）也读一次「出现了参考字形」。
  useEffect(() => {
    const p = prev.current;
    if (!trace || !trace.active || trace.status === 'loading' || p.traced === key) return;
    p.traced = key;
    say(traceAnnouncement(trace.status === 'ready' ? trace.total : 0));
  }, [key, trace && trace.active, trace && trace.status]);

  // 没有播报时不渲染文字节点：空串文字节点每次重画都会被 Preact 重写一次 data，读屏会当成一次变化（e2e 89 用 MutationObserver 数着）。
  return {
    message,
    node: html`<span class="sz-write__sr" role="status" aria-live="polite" aria-atomic="true" data-testid="write-sr-status">${message || null}</span>`,
  };
}
