// M5-6 坏值一次性顶部提示（01 §4：启动逐键形状校验，坏值搬到 shizi.corrupt.<key> 并顶部提示一次；03 P55 文案待定）。
//
// store.status.corruptNotice 只在本次启动新隔离了坏值时置上；原键已移走，刷新后不会再隔离，因此天然只提示一次。
// 挂载时读到就立刻 store.ackCorruptNotice()（本次启动内根组件重挂也不再出现），提示留到用户点关闭。
// 不写入任何数据。
//
// B3.13 原生化：原生壳里（window.__shiziNative）这一条浮条由原生画（L4 顶部浮条，样式按 D71）：
// 网页这边只发「显示 / 收起」消息（消息 'corrupt'），不画内容；文案在原生取 ShiziCopy（构建期生成），不依赖 JS 回包。
import { html, useEffect, useState } from '../../../vendor/ui.js';
import { t } from '../../config/copy/index.js';
import { Button } from './Button.js';
import { Icons } from './icons.js';
import { injectStyles, T } from './styles.js';
import { postNative } from '../../platform/bridge.js';
import { measureLines, viewportWidth } from './lines.js';

injectStyles('corrupt-notice', `
.sz-corrupt{position:absolute;left:${T.gutter};right:${T.gutter};top:calc(8px + env(safe-area-inset-top, 0px));z-index:45;box-sizing:border-box;
  display:flex;gap:8px;align-items:flex-start;padding:10px 6px 10px 16px;border-radius:${T.rBox};background:${T.toastBg};color:${T.toastFg};
  border:1px solid ${T.toastLine};box-shadow:${T.toastShadow}} /* L4 浮条外观（D71 ③）：浮起的浅面，不用实心深色 */
.sz-corrupt .sz-btn{color:inherit}
.sz-corrupt__text{flex:1;margin:0;padding-top:2px;font-size:${T.fs15};line-height:${T.lh15};color:inherit}
`);

// 每次渲染现取新 vnode，不复用模块级常量（vendor/ui.js 注释，M6-3）。
const CLOSE_ICON = () => Icons.close({ size: 18 });

/** 原生壳里（原生有这一条浮条）：网页不画，改由原生画。 */
function nativeOn(win) {
  return !!(win && win.__shiziNative === true);
}

/**
 * @param {{getStore: () => object}} props  取已启动的 store（没建成时抛错或返回 null）
 */
export function CorruptNotice({ getStore }) {
  const [notice, setNotice] = useState(null);
  const win = typeof window !== 'undefined' ? window : null;
  const native = nativeOn(win);

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

  // B3.13：原生浮条——显示 / 收起都发给原生（原生画这一条；点掉由原生自己收起）。
  // 折行点也一起给（网页量：原生按这些位置换行，与网页同一行）。
  useEffect(() => {
    if (!native || !notice) return undefined;
    postNative('native', { op: 'corrupt', show: true, keys: notice.keys, lines: corruptNoticeLines() });
    return () => postNative('native', { op: 'corrupt', show: false });
  }, [native, notice]);

  if (!notice) return null;
  // 原生画这一条（网页这边只发消息）：网页仍留着这一条，只是藏起来——页面脚本（QA 夹具）要点掉它来收起原生的浮条。
  return html`<div class="sz-corrupt" role="status" aria-live="polite" data-testid="corrupt-notice" style=${native ? 'display:none' : ''}
    data-keys=${notice.keys.join(',')}>
    <p class="sz-corrupt__text">${t('X-SYS.corruptNotice')}</p>
    <${Button} variant="icon" data-testid="corrupt-notice-close" aria-label=${t('X-COMMON.close')}
      onClick=${() => setNotice(null)}>${CLOSE_ICON()}</${Button}>
  </div>`;
}

/** 坏值提示的折行点（网页量，原生按这些位置换行；B3.F 起引擎模式 engine.js 也用它，根组件不挂）。 */
export function corruptNoticeLines() {
  return measureLines({
    text: t('X-SYS.corruptNotice'),
    variant: 'corrupt-text',
    width: viewportWidth(),
    parentCls: 'sz-corrupt',
    siblingCls: 'sz-btn sz-btn--icon',
    siblingTag: 'button',
  });
}
