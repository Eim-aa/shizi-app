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

export const html = htm.bind(h);

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
