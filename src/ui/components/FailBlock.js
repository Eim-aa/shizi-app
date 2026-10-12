// 保存失败三段式（交互与动效规范 S1，全 App 唯一写法；审计 P1-24 – P1-32「9 种不同形态」）：
//   1. 一句说明：发生了什么 + 用户的东西是否还在（各处文案按原因写，例如「没保存上，你写的字还在。」）；
//   2. 主按钮「再试一次」：留在原位（页面里是满宽主按钮，弹层里在确认键的位置）；
//   3. 文字按钮「先不保存 / 先不 X」：页面里在主按钮正上方的求助行（左对齐 20pt 线），弹层里在取消位（左）。
// 顺序全 App 固定：说明 → 先不 X → 再试一次（弹层：说明 → [先不 X | 再试一次]）（审计 P1-24 / P1-25）。B1：「先不保存」是文字按钮，不是次按钮。
// 位置：失败发生在哪就在哪（写字页底栏、判断两键、弹层内容就地换、设置分组下、备份页、图片预览里），不新开弹层、不用提示条（F3 ① 除外）。
// 不发触觉与声音（F1）；说明句经常驻的读屏播报区（Toast.js announce，aria-live=polite）读一次——容器一直在，iOS VoiceOver 才播得出来（P1-27 / P1-39）。
// 只有一个出口时（例如阻断页的重试：没有「先不」可选）传 onCancel: null。只有说明、没有操作时不该用这个组件（那不是三段式）。
// 再试成功后由调用方直接进入成功状态，不提示「已保存」（F5）。
import { html, useEffect } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { announce } from './Toast.js';
import { injectStyles, T } from './styles.js';
import { t } from '../../config/copy/index.js';

injectStyles('fail-block', `
.sz-fail{display:flex;flex-direction:column;align-items:stretch;gap:${T.s2};width:100%;box-sizing:border-box}
.sz-fail__note{margin:0 0 ${T.s1};font-size:${T.fs15};line-height:${T.lh15};color:${T.ink2};text-wrap:pretty}
.sz-fail__cancel{align-self:flex-start}
.sz-fail[data-layout="foot"] .sz-fail__note{text-align:center}
.sz-fail__btns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:${T.s3};align-items:center}
.sz-fail__btns--one{grid-template-columns:minmax(0,1fr)}
.sz-fail__btns .sz-btn--text{justify-self:center}
`);

/** 屏上就地出现的失败说明（写字页底栏这类自己排版的三段式）经常驻播报区读一次；空串不读。 */
export function useAnnounce(text) {
  useEffect(() => {
    if (text) announce(text);
  }, [text]);
}

/**
 * 同上的无 hook 版：纯视图里放一个 Announce({text})——一个隐藏的空 span，挂上 DOM 时（ref 回调）经播报区读一次，同一个元素同一句不重读。
 * 不用 hook / 组件，视图函数在单测里可以直接调用、按 testid 走 vnode 树。
 */
export function Announce({ text }) {
  if (!text) return null;
  return html`<span class="sz-fail__say" hidden aria-hidden="true" ref=${el => {
    if (!el || el.__szSaid === text) return;
    el.__szSaid = text;
    announce(text);
  }}></span>`;
}

/** 三段式的文字（缺省值）：说明「没保存上，你写的字还在。」、「再试一次」、「先不保存」（R-W16）。 */
export const FAIL_COPY = Object.freeze({
  text: () => t('R-W16.saveFailed'),
  retry: () => t('R-W16.retry'),
  cancel: () => t('R-W16.cancel'),
});

/**
 * @param {object} p
 * @param {string} [p.text]               第一句：发生了什么 + 东西还在不在（缺省 R-W16.saveFailed）
 * @param {() => void} [p.onRetry]        主按钮「再试一次」
 * @param {(() => void)|null} [p.onCancel] 文字按钮「先不 X」（null = 只有再试一次；省略时照样画，点了不做事）
 * @param {string} [p.retryLabel]         缺省「再试一次」（R-W16.retry）
 * @param {string} [p.cancelLabel]        缺省「先不保存」（R-W16.cancel）
 * @param {string} [p.testid]             外层 data-testid（缺省 fail）；说明 / 两键缺省 `${testid}-note` / `-cancel` / `-retry`
 * @param {string} [p.noteTestid]
 * @param {string} [p.cancelTestid]
 * @param {string} [p.retryTestid]
 * @param {boolean} [p.busy]              保存中：两键禁用
 * @param {'page'|'foot'|'dialog'} [p.layout]  page / foot：说明 → 先不 X（文字按钮，主按钮上方）→ 再试一次（满宽主按钮）；dialog：说明 → [先不 X | 再试一次]
 * @param {boolean} [p.speak]             false = 不经播报区（调用方自己已有常驻 live 区时）
 * @param {object} [p.attrs]              外层附加属性（data-*）
 */
export function FailBlock({
  text, onRetry, onCancel, retryLabel, cancelLabel, testid = 'fail', noteTestid, cancelTestid, retryTestid, busy = false, layout = 'page', speak = true, attrs = null,
}) {
  const sentence = text === undefined ? FAIL_COPY.text() : text;
  // 纯视图（不用 hook）：播报交给 <Announce>，调用方既可以写 <${FailBlock} …/> 也可以直接 FailBlock({…})（单测按 testid 走 vnode 树）
  const speakNode = speak && sentence ? Announce({ text: sentence }) : null;
  const cancel = onCancel !== null
    ? html`<${Button} variant="text" class="sz-fail__cancel" data-testid=${cancelTestid || `${testid}-cancel`} disabled=${busy} onClick=${onCancel}>${cancelLabel || FAIL_COPY.cancel()}</${Button}>`
    : null;
  const retry = onRetry !== null
    ? html`<${Button} variant="primary" data-testid=${retryTestid || `${testid}-retry`} disabled=${busy} onClick=${onRetry}>${retryLabel || FAIL_COPY.retry()}</${Button}>`
    : null;
  const note = sentence ? html`<p class="sz-fail__note" data-testid=${noteTestid || `${testid}-note`}>${sentence}</p>` : null;
  if (layout === 'dialog') {
    return html`<div class="sz-fail" data-testid=${testid} data-layout="dialog" ...${attrs || {}}>
      ${note}
      <div class=${cancel && retry ? 'sz-fail__btns' : 'sz-fail__btns sz-fail__btns--one'}>${cancel}${retry}</div>${speakNode}
    </div>`;
  }
  return html`<div class="sz-fail" data-testid=${testid} data-layout=${layout} ...${attrs || {}}>${note}${cancel}${retry}${speakNode}</div>`;
}
