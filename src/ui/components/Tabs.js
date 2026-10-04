// 底部三导航（决定-D02）：role=tablist，每项 role=tab + aria-selected。
// 键盘按 WAI-ARIA Tabs「漫游 tabindex、手动激活」（02 §8 M6-1；M0-4 三项都可 Tab 是过渡实现）：
// 只有选中项 tabindex=0（Tab 键进出 tablist 只停一次，落在选中项上），其余 tabindex=-1；
// 在 tablist 里左右方向键 / Home / End 移动焦点（首尾循环），不切换；Enter / Space（按钮原生点击）才切换。
// 规格取设计系统 v1 的 .sz-tabs（D43；真机用原生 UITabBar，只设 tint）：通栏、50px 高（×--k，加底部安全区）、纸色底、
// 顶部 0.5pt 发丝线，图标 24px、字 11px；选中 --ink1 并在标签下加 4px 圆点、未选 --ink3（不再是朱）。
import { html, useRef } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { injectStyles, T } from './styles.js';

injectStyles('tabs', `
.sz-tabs{flex:none;box-sizing:border-box;margin:0;height:calc(50px * ${T.k} + env(safe-area-inset-bottom, 0px));padding-bottom:env(safe-area-inset-bottom, 0px);
  border-top:${T.hair} solid ${T.line};background:${T.paper};display:flex;align-items:stretch}
.sz-tabs__tab{position:relative;flex:1;min-height:${T.hit};box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  padding:0 0 calc(6px * ${T.k}); /* 底部留出选中圆点的位置，圆点（标签下 5px）落在栏内、不被没有安全区的屏幕底边裁掉（Q2-11） */
  color:${T.ink3};font-size:${T.fs11};line-height:${T.lh11};font-weight:500} /* 行高按字阶 11 给（继承来的正文行高会让标签行盒比字大得多） */
.sz-tabs__tab[aria-selected="true"]{color:${T.ink1}}
.sz-tabs__tab span{position:relative}
.sz-tabs__tab[aria-selected="true"] span::after{content:"";position:absolute;left:50%;top:100%;width:4px;height:4px;margin:1px 0 0 -2px;
  border-radius:50%;background:currentColor}
.sz-tabs__tab svg{width:calc(24px * ${T.k});height:calc(24px * ${T.k})}
`);

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
    >${typeof item.icon === 'function' ? item.icon() : item.icon}<span>${item.label}</span></${Button}>`)}
  </div>`;
}
