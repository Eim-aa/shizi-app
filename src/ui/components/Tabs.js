// 底部三导航（决定-D02）：role=tablist，每项 role=tab + aria-selected。
// 键盘按 WAI-ARIA Tabs「漫游 tabindex、手动激活」（02 §8 M6-1；M0-4 三项都可 Tab 是过渡实现）：
// 只有选中项 tabindex=0（Tab 键进出 tablist 只停一次，落在选中项上），其余 tabindex=-1；
// 在 tablist 里左右方向键 / Home / End 移动焦点（首尾循环），不切换；Enter / Space（按钮原生点击）才切换。
// 规格取原型 ShiziScreen hasTabs：左右 12px 外边距、64px 高（×--k）、32px 圆角、--c 底、.5px --i5 边，
// 图标 22px、字 11px；选中 --ar、未选 --i3。
import { html, useRef } from '../../../vendor/ui.js';
import { Button } from './Button.js';
import { injectStyles, T } from './styles.js';

injectStyles('tabs', `
.sz-tabs{flex:none;box-sizing:border-box;margin:0 12px max(calc(22px * ${T.k}), env(safe-area-inset-bottom, 0px));
  height:calc(64px * ${T.k});border-radius:32px;background:${T.c};border:.5px solid ${T.i5};display:flex;align-items:stretch}
.sz-tabs__tab{flex:1;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
  border-radius:32px;color:${T.i3};font-size:calc(11px * ${T.k});letter-spacing:.06em}
.sz-tabs__tab[aria-selected="true"]{color:${T.ar}}
.sz-tabs__tab svg{width:calc(22px * ${T.k});height:calc(22px * ${T.k})}
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
