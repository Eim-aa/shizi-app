// UI 层唯一入口：聚合 vendored preact / hooks / htm，业务代码只从这里 import。
// 来源与 SHA-256 见 THIRD_PARTY_NOTICES.md；vendor 文件由 scripts/vendor_preact.mjs 写出。
import { h, render, Fragment, options, createContext } from './preact.module.js';
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  useReducer,
  useContext,
} from './preact-hooks.module.js';
import htm from './htm.module.js';

// htm 默认把「不含插值的整棵子树」缓存成同一个 vnode 对象，每次求值都复用它（htm README「Caching」）。Preact 第一次
// 挂载时把这个共享对象直接放进树里（设父指针），重渲染时换成副本、原对象既不再出现也不会被卸载——它的父指针链会一直
// 抓着第一次渲染的整棵旧 vnode 树及其 DOM（M6-3 61-perf：页面出栈后整页 DOM、canvas 与墨迹点列留在堆里）。
// 在 h 里置 this[0] = 3 关闭这层缓存（htm 文档给的开关），每次求值都产出新 vnode。模块顶层的 html`…` 常量同理
// 不要复用，写成 () => html`…` 每次渲染现取。
function freshH() {
  this[0] = 3;
  return h.apply(null, arguments);
}

export const html = htm.bind(freshH);

export {
  h,
  render,
  Fragment,
  options,
  createContext,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  useReducer,
  useContext,
};
