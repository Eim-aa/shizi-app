// 底部三导航（决定-D02）：role=tablist，每项 role=tab + aria-selected。
// 键盘按 WAI-ARIA Tabs「漫游 tabindex、手动激活」（02 §8 M6-1；M0-4 三项都可 Tab 是过渡实现）：
// 只有选中项 tabindex=0（Tab 键进出 tablist 只停一次，落在选中项上），其余 tabindex=-1；
// 在 tablist 里左右方向键 / Home / End 移动焦点（首尾循环），不切换；Enter / Space（按钮原生点击）才切换。
// 规格取设计系统 v1 的 .sz-tabs（D43；真机用原生 UITabBar，只设 tint）与减法修稿（D49，实现交接 §0.3）：通栏、高 49（加底部安全区：402 → 83，
// SE → 49）、纸色底、顶部 0.5pt 发丝线；图标 24、标签 11 **固定，不读 --k、AX 档也不放大**（系统 UITabBar 的行为；AX 档长按出大字预览属阶段 3 原生）。
// 选中 = 实心图标 + --ink1，未选 = 线描图标 + --ink3；不画小圆点（D49）。Q2-11 的「封顶」约束保留并收紧为「不放大」：任何字号档下栏都落在屏内。
import { html, useRef } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { injectStyles, T } from './styles.js';
import { hasTabIcon, tabIcon } from './tab-icons.js';

injectStyles('tabs', `
.sz-tabs{flex:none;box-sizing:border-box;margin:0;height:calc(49px + env(safe-area-inset-bottom, 0px));padding-bottom:env(safe-area-inset-bottom, 0px);
  border-top:${T.hair} solid ${T.line};background:${T.paper};display:flex;align-items:stretch}
.sz-tabs__tab{position:relative;flex:1;min-height:${T.hit};box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  padding:0;color:${T.ink3};font-size:calc(11px * 1);line-height:13px;font-weight:500} /* 标签 11 / 13 固定（不读 --k，D49） */
.sz-tabs__tab[aria-selected="true"]{color:${T.ink1}}
.sz-tabs__tab svg{width:24px;height:24px;flex:none}
`);

/** 选中用实心、未选用线描（只认 home / library / mine，其余沿用 Tab 自己注册的图标）。 */
function tabIconOf(item, selected) {
  if (hasTabIcon(item.id)) return tabIcon(item.id, selected);
  return typeof item.icon === 'function' ? item.icon() : item.icon;
}

/**
 * @param {object} props
 * @param {{id:string, label:string, icon?:any, panelId?:string}[]} props.items
 * @param {string} props.selected
 * @param {(id:string) => void} props.onSelect
 * @param {string} [props.label]  tablist 的 aria-label
 */
export function Tabs({ items, selected, onSelect, label }) {
  const listRef = useRef(null);
  const onKeyDown = event => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key) || !listRef.current) return;
    const tabs = [...listRef.current.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    event.preventDefault();
    let j = i;
    if (event.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') j = (i + 1) % tabs.length;
    if (event.key === 'Home') j = 0;
    if (event.key === 'End') j = tabs.length - 1;
    tabs[j].focus();
  };
  return html`<div class="sz-tabs" role="tablist" aria-label=${label} ref=${listRef} onKeyDown=${onKeyDown}>
    ${items.map(item => html`<${Button}
      key=${item.id}
      variant="plain"
      class="sz-tabs__tab"
      role="tab"
      id=${`sz-tab-${item.id}`}
      data-testid=${`tab-${item.id}`}
      aria-selected=${item.id === selected ? 'true' : 'false'}
      tabindex=${item.id === selected ? '0' : '-1'}
      aria-controls=${item.panelId}
      onClick=${() => { if (item.id !== selected) onSelect(item.id); }}
    >${tabIconOf(item, item.id === selected)}<span>${item.label}</span></${Button}>`)}
  </div>`;
}
