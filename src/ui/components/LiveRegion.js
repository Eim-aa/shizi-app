// 常驻的读屏播报区（A2「状态变化用 aria-live=polite 播报，不抢焦点」；I3 · P1-39）。
// iOS VoiceOver 对「live 区和文字同一次渲染挂上」的内容常常不播报：这个区一直挂在页面上（视觉隐藏），只换里面的文字，读屏才会读。
// 页面上看得见的失败说明 / 状态句照常画（不再自带 aria-live），同一句话交给这里播报。
// 没有文字时不渲染文字节点（空串文字节点每次重画都会被 Preact 重写一次，读屏会当成一次变化，同 write/sr-live.js）。
import { html } from '../../../vendor/ui.js';
import { injectStyles } from './styles.js';

injectStyles('live-region', `
.sz-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
`);

/**
 * @param {{text?:string, testid?:string}} props
 */
export function LiveRegion({ text = '', testid }) {
  return html`<span class="sz-live" role="status" aria-live="polite" aria-atomic="true" data-testid=${testid}>${text || null}</span>`;
}
