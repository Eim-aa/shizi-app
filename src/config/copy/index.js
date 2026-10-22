// 文案入口：合并各屏文案表，并提供占位符填充。
// 各屏文件的键 = 需求条目 id + 槽名（如 'R-W05.hintRemaining'），值与 docs/engineering/v10/copy-source.json
// 逐字一致（scripts/verify_copy.mjs）。占位符统一为 {n} {m} {date} {char} … 见 copy-source.json placeholders。

import common from './common.js';
import home from './home.js';
import write from './write.js';
import judge from './judge.js';
import result from './result.js';
import library from './library.js';
import detail from './detail.js';
import query from './query.js';
import mine from './mine.js';
import backup from './backup.js';
import settings from './settings.js';
import about from './about.js';
import images from './images.js';
import work from './work.js';
import * as defaultPolicy from '../policy.js';

export const SCREENS = Object.freeze({
  common,
  home,
  write,
  judge,
  result,
  library,
  detail,
  query,
  mine,
  backup,
  settings,
  about,
  images,
  work,
});

function merge(screens) {
  const out = {};
  for (const [screen, table] of Object.entries(screens)) {
    for (const [key, value] of Object.entries(table)) {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        throw new Error('copy key defined twice: ' + key + ' (' + screen + ')');
      }
      out[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
    }
  }
  return Object.freeze(out);
}

export const COPY = merge(SCREENS);

/** 占位符填充：'{n} / {total}' + {n:3,total:5} → '3 / 5'。缺值的占位符原样保留。 */
export function format(template, vars) {
  const fill = (s) =>
    s.replace(/\{([A-Za-z]+)\}/g, (whole, name) =>
      vars && Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== undefined && vars[name] !== null
        ? String(vars[name])
        : whole,
    );
  return Array.isArray(template) ? template.map(fill) : fill(template);
}

/** 取文案并填充占位符；键不存在直接抛错（文案门禁保证键齐全）。数组值返回数组（多行）。 */
export function t(key, vars) {
  if (!Object.prototype.hasOwnProperty.call(COPY, key)) throw new Error('unknown copy key: ' + key);
  return format(COPY[key], vars);
}

/**
 * 涉及「笔迹」承诺的文案：policy.features.perRecordInk（P31）为 true 时取 base 槽；为 false（现行默认）时格子 / 小图
 * 实际画的是标准字形（或本页面会话里刚写的笔画），取 base + 'Glyph' 变体，不承诺「你最近一次的笔迹」。
 * 读的是 policy 的实时值（e2e 会在页面里把它改成 true）。
 */
export function inkKey(base, policy = defaultPolicy) {
  return policy && policy.features && policy.features.perRecordInk === true ? base : base + 'Glyph';
}

/** t(inkKey(base))：按 perRecordInk 选文案槽。 */
export function tInk(base, vars, policy = defaultPolicy) {
  return t(inkKey(base, policy), vars);
}

/**
 * 文案引用「键 + 参数」（B3.4）：形如 { copy: 键, params }（字段名用 copy，避开视图模型里常见的 key 字段）：视图模型（src/session/views/）不拼用户可见的句子，只给这个引用；网页用 tRef 渲染成 t(key, params)，
 * 原生用 Copy 渲染（B4 后不变）。参数值可以再是一个引用（例如日期句嵌进「写错」那一句），tRef 递归展开。
 */
export function ref(key, params) {
  return params === undefined ? Object.freeze({ copy: key }) : Object.freeze({ copy: key, params });
}

/** 是不是文案引用。 */
export function isRef(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.copy === 'string';
}

/** 把文案引用渲染成句子（等于 t(ref.copy, ref.params)，参数里的引用先展开）；null / '' / 非引用的字符串原样返回（空串不当键）。 */
export function tRef(value) {
  if (!isRef(value)) return value == null ? '' : value;
  let vars = value.params;
  if (vars && typeof vars === 'object') {
    vars = {};
    for (const k of Object.keys(value.params)) vars[k] = isRef(value.params[k]) ? tRef(value.params[k]) : value.params[k];
  }
  return t(value.copy, vars);
}

/** 把任意结构里的文案引用全部渲染成句子（深拷贝；测试用它对「视图模型 → t() 渲染」做一字不差的核对，也是原生渲染前的参照实现）。 */
export function renderRefs(value) {
  if (isRef(value)) return tRef(value);
  if (Array.isArray(value)) return value.map(renderRefs);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = renderRefs(value[k]);
    return out;
  }
  return value;
}

/** 是否有这个键。 */
export function has(key) {
  return Object.prototype.hasOwnProperty.call(COPY, key);
}
