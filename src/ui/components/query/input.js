// 查字框：iOS 同步 focus（R-Q08）、键盘避让（visualViewport）、输入法组字期间不过滤。
//
// iOS 同步 focus（04 R-Q08；reference/K-proto-home-lib.md §5-6：原型 80ms / 30ms 异步 focus 在 iOS 上弹不出键盘）：
//   iOS Safari / WKWebView 只在用户手势的同一个事件处理里调用 focus() 才弹键盘；弹层由 router → Preact 异步渲染，
//   点击处理结束时真正的输入框还不在 DOM 里。所以 openQuery() 在点击处理里**同步**聚焦一个一直挂在 body 上的
//   透明代理输入框（focusProxyInput），键盘先弹起；弹层挂上后把焦点从代理框移到真正的查字框
//   （键盘已经弹起时，输入框之间转移焦点不需要手势），再让代理框失焦。
//
// 键盘避让：visualViewport 可见区缩小时（键盘弹起），弹层底边抬到可见区底边，最大高度按可见区算；输入框在弹层顶部、
//   底部按钮 sticky 在弹层底部，两者都留在可见区里。没有 visualViewport 的环境不做调整。
//
// 输入法：中文输入法组字期间（compositionstart…compositionend）框里是拼音字母，不能按「只能输入汉字」过滤——
//   组字结束才把文字交给弹层。输入框不受控（value 只在挂载时给初值），原文保留、不截断（P45）。
//   F6：事件顺序因引擎而异——WebKit（iOS）选字时 input(isComposing=true) 之后只有 compositionend，没有 isComposing=false
//   的 input；Chromium 在 compositionend 之后还会补一个 isComposing=false 的 input。所以必须在 compositionend 时用输入框
//   的最终值更新一次（createTextGate），同值去重。另外 Preact 对 onCompositionStart / onCompositionEnd 这种驼峰名挂的是
//   区分大小写的 'CompositionStart'（元素上没有 oncompositionstart 属性，不会被转成小写），事件永远不触发——所以这里用全小写的
//   oncompositionstart / oncompositionend。

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../../../vendor/ui.js';
import { injectStyles, T } from '../styles.js';

export const PROXY_ATTR = 'data-query-focus-proxy';

injectStyles('query-input', `
.sz-query__input{width:100%;min-height:52px;box-sizing:border-box;margin:0;border:1px solid transparent;border-radius:${T.rCtl};
  background:${T.field};padding:0 16px;font-family:${T.kai};font-size:${T.fs22};color:${T.ink1};outline:none;
  -webkit-appearance:none;appearance:none}
.sz-query__input::placeholder{color:${T.ink2}}
.sz-query__input:focus-visible{border-color:${T.ink1}}
`);

function doc(win) {
  return win && win.document ? win.document : typeof document !== 'undefined' ? document : null;
}

/**
 * 在当前（用户点击的）事件处理里同步聚焦代理输入框，让 iOS 先弹键盘。返回代理框（没有 DOM 时 null）。
 * 代理框 16px 字号（iOS 小于 16px 会缩放页面）、透明、不占位、不进读屏与 Tab 顺序。
 */
export function focusProxyInput(win = typeof window !== 'undefined' ? window : null) {
  const d = doc(win);
  if (!d || !d.body) return null;
  let proxy = d.querySelector(`input[${PROXY_ATTR}]`);
  if (!proxy) {
    proxy = d.createElement('input');
    proxy.setAttribute(PROXY_ATTR, '');
    proxy.setAttribute('aria-hidden', 'true');
    proxy.setAttribute('tabindex', '-1');
    proxy.setAttribute('autocomplete', 'off');
    proxy.type = 'text';
    Object.assign(proxy.style, {
      position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', border: '0', padding: '0',
      margin: '0', fontSize: '16px', pointerEvents: 'none', zIndex: '-1',
    });
    d.body.appendChild(proxy);
  }
  try {
    proxy.focus({ preventScroll: true });
  } catch (error) {
    proxy.focus();
  }
  return proxy;
}

/**
 * 焦点从代理框移到真正的输入框（键盘不收起），然后移除代理框——它不再是任何人的焦点归还目标
 * （Sheet 在挂载时记下的「打开前焦点」就是代理框，移除后 Sheet 不会把焦点还给它；归还由 QuerySheet 做）。
 */
export function handOffFocus(input, win = typeof window !== 'undefined' ? window : null) {
  const d = doc(win);
  if (input) {
    try {
      input.focus({ preventScroll: true });
    } catch (error) {
      input.focus();
    }
  }
  const proxy = d ? d.querySelector(`input[${PROXY_ATTR}]`) : null;
  if (proxy && proxy.parentNode) proxy.parentNode.removeChild(proxy);
  return !!input && !!d && d.activeElement === input;
}

/**
 * 键盘占用高度（CSS px）：布局视口底边 − 可见区底边（visualViewport.offsetTop + height）。
 * @param {{innerHeight:number}} win  @param {{height:number, offsetTop?:number}|null} vv
 */
export function keyboardInset(win, vv) {
  if (!win || !vv || !Number.isFinite(vv.height)) return 0;
  const layout = Number(win.innerHeight) || 0;
  const bottom = (Number(vv.offsetTop) || 0) + vv.height;
  return Math.max(0, Math.round(layout - bottom));
}

/**
 * 可见区：{inset, height, top}；随 visualViewport resize / scroll 更新。没有 visualViewport 时 null。
 * 读的是 win.visualViewport 挂载时的那个对象（e2e 可换成假的 EventTarget 模拟键盘弹起）。
 */
export function useVisualViewport(win = typeof window !== 'undefined' ? window : null) {
  const read = () => {
    const vv = win && win.visualViewport;
    if (!vv) return null;
    return { inset: keyboardInset(win, vv), height: vv.height, top: Number(vv.offsetTop) || 0 };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const vv = win && win.visualViewport;
    if (!vv || typeof vv.addEventListener !== 'function') return undefined;
    const on = () => {
      const next = read();
      setState(prev => (prev && next && prev.inset === next.inset && prev.height === next.height && prev.top === next.top ? prev : next));
    };
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    if (win.addEventListener) win.addEventListener('resize', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
      if (win.removeEventListener) win.removeEventListener('resize', on);
    };
  }, []);
  return state;
}

/** 弹层面板（Sheet 的 .sz-sheet）按可见区调整：底边、最小 / 最大高度、底部内边距（原型 L444：键盘弹起时 16px）。 */
export function sheetFrameStyle(viewport) {
  if (!viewport) return { bottom: '', maxHeight: '', minHeight: '64%', paddingBottom: '', pb: 'max(32px, env(safe-area-inset-bottom, 0px))' }; // 32 = Sheet 面板的底部内边距（P1-E1b 由 34 改）
  const h = Math.max(0, viewport.height);
  const pb = viewport.inset > 0 ? '16px' : 'max(32px, env(safe-area-inset-bottom, 0px))';
  return {
    bottom: `${viewport.inset}px`,
    maxHeight: `${Math.floor(h * 0.88)}px`,
    minHeight: `${Math.floor(h * 0.64)}px`,
    paddingBottom: viewport.inset > 0 ? pb : '',
    pb,
  };
}

/**
 * 输入 → onText 的闸门（纯函数，test/ui/query.test.mjs）。返回 {onInput, onCompositionStart, onCompositionEnd}，
 * 参数是事件（只读 target / currentTarget 的 value 与 isComposing）。
 *   组字中（compositionstart…compositionend）的 input 不上报（框里是拼音字母）；
 *   compositionend 用输入框此刻的值上报一次（WebKit：input(isComposing=true) 之后只有 compositionend）；
 *   组字外的 input 照常上报（Chromium：compositionend 之后补来的 isComposing=false 的 input）；
 *   和上一次上报同值时不重复上报。没见过 compositionstart 的环境里，仍按 event.isComposing 判断组字中。
 */
export function createTextGate(onText, initial = '') {
  let composing = false;
  let seenStart = false;
  let last = initial;
  const valueOf = e => {
    const el = e && (e.currentTarget || e.target);
    return el && typeof el.value === 'string' ? el.value : null;
  };
  const emit = e => {
    const v = valueOf(e);
    if (v === null || v === last) return;
    last = v;
    if (onText) onText(v);
  };
  return {
    onCompositionStart: () => { composing = true; seenStart = true; },
    onCompositionEnd: e => { composing = false; emit(e); },
    onInput: e => {
      if (composing || (!seenStart && e && e.isComposing)) return;
      emit(e);
    },
  };
}

/**
 * 查字输入框。不受控：初值 initial；组字结束或普通输入时 onText(原文)。
 * inputRef 交给弹层做焦点转移。
 */
export function QueryInput({ initial = '', label, placeholder, onText, inputRef, testid = 'query-input' }) {
  const ownRef = useRef(null);
  const ref = inputRef || ownRef;
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const gate = useRef(null);
  if (!gate.current) gate.current = createTextGate(v => onTextRef.current && onTextRef.current(v), initial);
  useLayoutEffect(() => {
    if (ref.current && initial && !ref.current.value) ref.current.value = initial;
  }, []);
  // 事件名全小写：Preact 把 onCompositionEnd 挂成区分大小写的 'CompositionEnd'，永远收不到（见文件头 F6）。
  return html`<input class="sz-query__input" ref=${ref} type="text" data-testid=${testid}
    aria-label=${label} placeholder=${placeholder} autocomplete="off" autocorrect="off" autocapitalize="off"
    spellcheck=${false} enterkeyhint="done" lang="zh-CN"
    oncompositionstart=${gate.current.onCompositionStart}
    oncompositionend=${gate.current.onCompositionEnd}
    onInput=${gate.current.onInput}
    onKeyDown=${e => { if (e.key === 'Enter' && !e.isComposing) e.currentTarget.blur(); }} />`;
}
