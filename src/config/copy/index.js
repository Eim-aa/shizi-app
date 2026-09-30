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

/** 是否有这个键。 */
export function has(key) {
  return Object.prototype.hasOwnProperty.call(COPY, key);
}
