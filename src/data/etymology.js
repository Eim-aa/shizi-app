// 字源数据（data/etymology.json：{char, gloss, source}；R-D09）。B3.7：从 ui/screens/detail/records.js 挪来（无 DOM、无 Preact），
// 网页字详情页（useEtymology hook）与 App API 的 view.detail 共用同一份读取与缓存；行为不变。

export const ETYMOLOGY_URL = 'data/etymology.json';

let etymology = null; // Map<char, {gloss, source}>
let etymologyPromise = null;
const etymologyListeners = new Set();

/** 读 data/etymology.json（一次；失败不缓存，下次打开再试）。 */
export function loadEtymology(fetchFn = typeof fetch === 'function' ? fetch : null) {
  if (etymology) return Promise.resolve(etymology);
  if (etymologyPromise) return etymologyPromise;
  if (!fetchFn) return Promise.resolve(null);
  etymologyPromise = Promise.resolve()
    .then(() => fetchFn(ETYMOLOGY_URL))
    .then(res => (res && res.ok ? res.json() : null))
    .then(rows => {
      if (!Array.isArray(rows)) throw new Error('etymology data unavailable');
      const map = new Map();
      for (const row of rows) {
        if (row && typeof row.char === 'string' && typeof row.gloss === 'string' && row.gloss) {
          map.set(row.char, { gloss: row.gloss, source: typeof row.source === 'string' ? row.source : '' });
        }
      }
      etymology = map;
      for (const fn of [...etymologyListeners]) fn(map);
      return map;
    })
    .catch(() => {
      etymologyPromise = null;
      return null;
    });
  return etymologyPromise;
}

/** 测试用：注入 / 清掉字源表。 */
export function setEtymology(rows) {
  etymologyPromise = null;
  etymology = Array.isArray(rows) ? new Map(rows.map(r => [r.char, { gloss: r.gloss, source: r.source || '' }])) : null;
}

export function etymologyOf(char) {
  return etymology ? etymology.get(char) || null : null;
}

/** 字源表读好时回调（页面 hook 用）；返回退订。 */
export function onEtymologyLoaded(fn) {
  etymologyListeners.add(fn);
  return () => etymologyListeners.delete(fn);
}

/** 当前是否已有字源表（不触发读取）。 */
export function etymologyReady() {
  return !!etymology;
}
