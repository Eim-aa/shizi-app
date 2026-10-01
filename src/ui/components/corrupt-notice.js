// M5-6 坏值一次性顶部提示（01 §4：启动逐键形状校验，坏值搬到 shizi.corrupt.<key> 并顶部提示一次；03 P55 文案待定）。
//
// store.status.corruptNotice 只在本次启动新隔离了坏值时置上；原键已移走，刷新后不会再隔离，因此天然只提示一次。
// 挂载时读到就立刻 store.ackCorruptNotice()（本次启动内根组件重挂也不再出现），提示留到用户点关闭。
// 不写入任何数据。
import { html, useEffect, useState } from '../../../vendor/ui.js';
import { t } from '../../config/copy/index.js';
import { Button } from './Button.js';
import { injectStyles, T } from './styles.js';

injectStyles('corrupt-notice', `
.sz-corrupt{position:absolute;left:16px;right:16px;top:calc(8px + env(safe-area-inset-top, 0px));z-index:45;box-sizing:border-box;
  display:flex;gap:8px;align-items:flex-start;padding:10px 6px 10px 16px;border-radius:14px;background:${T.off};
  box-shadow:0 6px 18px rgba(48,38,26,.10)}
.sz-corrupt__text{flex:1;margin:0;padding-top:2px;font-size:calc(15px * ${T.k});line-height:1.7;color:${T.i2}}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const CLOSE_ICON = () => html`<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"
  stroke-width="1.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5 5 15"></path></svg>`;

/**
 * @param {{getStore: () => object}} props  取已启动的 store（没建成时抛错或返回 null）
 */
export function CorruptNotice({ getStore }) {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let store = null;
    try {
      store = getStore();
    } catch (error) {
      store = null;
    }
    if (!store) return undefined;
    const check = () => {
      const current = store.status.corruptNotice;
      if (!current) return;
      store.ackCorruptNotice();
      setNotice({ keys: Array.isArray(current.keys) ? current.keys.slice() : [] });
    };
    check();
    return store.subscribe(check);
  }, [getStore]);

  if (!notice) return null;
  return html`<div class="sz-corrupt" role="status" aria-live="polite" data-testid="corrupt-notice"
    data-keys=${notice.keys.join(',')}>
    <p class="sz-corrupt__text">${t('X-SYS.corruptNotice')}</p>
    <${Button} variant="icon" data-testid="corrupt-notice-close" aria-label=${t('X-COMMON.close')}
      onClick=${() => setNotice(null)}>${CLOSE_ICON()}</${Button}>
  </div>`;
}
