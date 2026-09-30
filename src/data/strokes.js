// 笔顺数据访问（01-架构设计 §2 data/、§8.5；02 M1-2）。
//
// data/<字>.json 是 hanzi-writer-data 格式：{ strokes: string[]（SVG path，1024 单位、y 向上、基线 900），
// medians: [x,y][][]，radStrokes?: number[] }（reference/O-data.md §3.3）。
//
// 规则：
// - 内嵌数据优先：globalThis.SHIZI_STROKE_DATA（{字: json}）或注入的 embedded 表/函数里有这个字就直接用，不发请求。
//   注意：现在的 core-strokes.js 只有 600 字字表（self.SHIZI_CORE_STROKES，给 SW 预缓存用），不含字形数据，
//   所以内嵌表今天是空的——离线靠 SW 缓存优先策略（01 §8.3）；将来生成器若内嵌数据，按上面的全局名挂即可。
// - 然后查 LRU（只缓存成功结果；失败不缓存，下次调用会重新取——联网恢复后重试当前字靠这一点）。
// - 网络：每次尝试 3s 超时（fetch + 解析 JSON 一起计时，AbortController 能用就真的中断），失败再试 1 次（01 §8.5）；
//   404/410 视为「没有这个字的数据」不重试；内容形状不对视为损坏不重试。
// - 永不 reject：拿不到就返回 null，调用方进 10.13 分支（ui/screens/write/glyph-fallback.js）。
// - 同一个字同时只发一路请求（并发调用共享同一个 Promise）。
//
// 这些是工程常量（01 §8.5 已写死 3s + 1 次），不是待产品决定的过渡值，所以不在 policy.js。

export const STROKES_TIMEOUT_MS = 3000;
export const STROKES_RETRIES = 1;
export const STROKES_RETRY_DELAY_MS = 250;
export const STROKES_LRU_SIZE = 64;
export const EMBEDDED_GLOBAL = 'SHIZI_STROKE_DATA';

/** 数据文件的相对 URL（与旧 charLoader、sw.js 的笔顺路由同形）。 */
export function strokesURL(char, base = 'data/') {
  return base + encodeURIComponent(char) + '.json';
}

/** 单个码点（含补充平面字）才去取数据；其余一律无数据。 */
export function isSingleChar(char) {
  if (typeof char !== 'string' || char.length === 0 || char.length > 2) return false;
  return Array.from(char).length === 1;
}

function isPoint(p) {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * 校验并规整一份笔顺 JSON。合格返回 { strokes, medians, radStrokes? }（数组已冻结，调用方不要改），否则 null。
 * 合格条件：strokes 为非空字符串数组；medians 与 strokes 等长，每笔至少 1 个 [x,y] 有限数点。
 */
export function validateStrokes(json) {
  if (!json || typeof json !== 'object') return null;
  const { strokes, medians, radStrokes } = json;
  if (!Array.isArray(strokes) || strokes.length === 0) return null;
  if (!Array.isArray(medians) || medians.length !== strokes.length) return null;
  for (const s of strokes) if (typeof s !== 'string' || s.trim() === '') return null;
  for (const m of medians) {
    if (!Array.isArray(m) || m.length === 0) return null;
    for (const p of m) if (!isPoint(p)) return null;
  }
  const out = {
    strokes: Object.freeze(strokes.slice()),
    medians: Object.freeze(medians.map(m => Object.freeze(m.map(p => Object.freeze([p[0], p[1]]))))),
  };
  if (Array.isArray(radStrokes) && radStrokes.every(i => Number.isInteger(i) && i >= 0 && i < strokes.length)) {
    out.radStrokes = Object.freeze(radStrokes.slice());
  }
  return Object.freeze(out);
}

function defaultFetch() {
  return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
}

function embeddedLookup(embedded, char) {
  let raw;
  try {
    if (typeof embedded === 'function') raw = embedded(char);
    else if (embedded && typeof embedded === 'object') raw = Object.prototype.hasOwnProperty.call(embedded, char) ? embedded[char] : undefined;
    else {
      const table = globalThis[EMBEDDED_GLOBAL];
      raw = table && typeof table === 'object' && Object.prototype.hasOwnProperty.call(table, char) ? table[char] : undefined;
    }
  } catch (error) {
    raw = undefined;
  }
  return raw === undefined || raw === null ? null : validateStrokes(raw);
}

class AttemptError extends Error {
  constructor(reason, retry) {
    super(reason);
    this.reason = reason;
    this.retry = retry;
  }
}

/**
 * 建一个加载器（单测注入 fetch / 计时器；页面用模块级默认实例）。
 * @param {object} [o]
 * @param {Function} [o.fetch]            (url, {signal}) => Promise<Response 形状：{ok,status,json()}>
 * @param {number}   [o.timeoutMs=3000]   每次尝试的超时
 * @param {number}   [o.retries=1]        失败后再试几次
 * @param {number}   [o.retryDelayMs=250]
 * @param {number}   [o.lruSize=64]
 * @param {object|Function} [o.embedded]  内嵌表 {字: json} 或 (字) => json；缺省读 globalThis.SHIZI_STROKE_DATA
 * @param {string}   [o.base='data/']
 * @param {Function} [o.setTimeout] [o.clearTimeout]
 */
export function createStrokesLoader(o = {}) {
  const fetchImpl = o.fetch || null;
  const timeoutMs = Number.isFinite(o.timeoutMs) ? o.timeoutMs : STROKES_TIMEOUT_MS;
  const retries = Number.isInteger(o.retries) && o.retries >= 0 ? o.retries : STROKES_RETRIES;
  const retryDelayMs = Number.isFinite(o.retryDelayMs) ? o.retryDelayMs : STROKES_RETRY_DELAY_MS;
  const lruSize = Number.isInteger(o.lruSize) && o.lruSize > 0 ? o.lruSize : STROKES_LRU_SIZE;
  const base = typeof o.base === 'string' ? o.base : 'data/';
  const setT = o.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearT = o.clearTimeout || (id => clearTimeout(id));

  const lru = new Map(); // char → data（Map 迭代序 = 最久未用在前）
  const inflight = new Map(); // char → Promise<detail>
  const stats = { requests: 0, hits: 0, embedded: 0, failures: 0, evictions: 0 };

  function touch(char, data) {
    if (lru.has(char)) lru.delete(char);
    lru.set(char, data);
    while (lru.size > lruSize) {
      const oldest = lru.keys().next().value;
      lru.delete(oldest);
      stats.evictions += 1;
    }
  }

  function wait(ms) {
    return ms > 0 ? new Promise(resolve => setT(resolve, ms)) : Promise.resolve();
  }

  // 一次尝试：fetch + json 一起受 timeoutMs 约束。
  function attempt(char) {
    const doFetch = fetchImpl || defaultFetch();
    if (!doFetch) return Promise.reject(new AttemptError('no-fetch', false));
    stats.requests += 1;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setT(() => {
        if (done) return;
        done = true;
        try {
          if (controller) controller.abort();
        } catch (error) {
          // 忽略
        }
        reject(new AttemptError('timeout', true));
      }, timeoutMs);
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearT(timer);
        fn(value);
      };
      Promise.resolve()
        .then(() => doFetch(strokesURL(char, base), controller ? { signal: controller.signal } : undefined))
        .then(res => {
          if (!res || typeof res !== 'object') throw new AttemptError('network', true);
          if (!res.ok) {
            const status = Number(res.status) || 0;
            throw new AttemptError(status === 404 || status === 410 ? 'not-found' : 'http', !(status === 404 || status === 410));
          }
          return res.json().catch(() => {
            throw new AttemptError('invalid', false);
          });
        })
        .then(json => {
          const data = validateStrokes(json);
          if (!data) throw new AttemptError('invalid', false);
          finish(resolve, data);
        })
        .catch(error => {
          finish(reject, error instanceof AttemptError ? error : new AttemptError('network', true));
        });
    });
  }

  async function fetchWithRetry(char) {
    let attempts = 0;
    let last = null;
    for (;;) {
      attempts += 1;
      try {
        const data = await attempt(char);
        return { data, source: 'network', reason: null, attempts };
      } catch (error) {
        last = error;
        if (!error.retry || attempts > retries) break;
        await wait(retryDelayMs);
      }
    }
    stats.failures += 1;
    return { data: null, source: null, reason: last ? last.reason : 'network', attempts };
  }

  /**
   * 取一个字的笔顺数据，带来源与失败原因。永不 reject。
   * @returns {Promise<{data: object|null, source: 'embedded'|'cache'|'network'|null,
   *   reason: null|'bad-char'|'timeout'|'network'|'http'|'not-found'|'invalid'|'no-fetch', attempts: number}>}
   */
  function loadDetailed(char) {
    if (!isSingleChar(char)) return Promise.resolve({ data: null, source: null, reason: 'bad-char', attempts: 0 });
    const emb = embeddedLookup(o.embedded, char);
    if (emb) {
      stats.embedded += 1;
      return Promise.resolve({ data: emb, source: 'embedded', reason: null, attempts: 0 });
    }
    if (lru.has(char)) {
      const data = lru.get(char);
      touch(char, data);
      stats.hits += 1;
      return Promise.resolve({ data, source: 'cache', reason: null, attempts: 0 });
    }
    if (inflight.has(char)) return inflight.get(char);
    const p = fetchWithRetry(char)
      .catch(() => ({ data: null, source: null, reason: 'network', attempts: 0 }))
      .then(detail => {
        inflight.delete(char);
        if (detail.data) touch(char, detail.data);
        return detail;
      });
    inflight.set(char, p);
    return p;
  }

  return {
    loadDetailed,
    /** 取数据；拿不到返回 null。 */
    load: char => loadDetailed(char).then(d => d.data),
    /** 同步窥视：内嵌或 LRU 里有就返回（不改 LRU 顺序），否则 undefined。 */
    peek(char) {
      if (!isSingleChar(char)) return undefined;
      const emb = embeddedLookup(o.embedded, char);
      if (emb) return emb;
      return lru.has(char) ? lru.get(char) : undefined;
    },
    /** 预热若干字（不等结果）。 */
    prefetch(chars) {
      for (const c of new Set(chars || [])) loadDetailed(c);
    },
    isLoading: char => inflight.has(char),
    cachedChars: () => [...lru.keys()],
    clear() {
      lru.clear();
    },
    stats: () => ({ ...stats, cached: lru.size, inflight: inflight.size }),
  };
}

// ---------------------------------------------------------------- 模块级默认实例

let defaultLoader = null;

export function getStrokesLoader() {
  if (!defaultLoader) defaultLoader = createStrokesLoader();
  return defaultLoader;
}

/** 仅供测试替换默认实例；传 null 复原。 */
export function setStrokesLoader(loader) {
  defaultLoader = loader || null;
}

/** loadStrokes(char) → Promise<data|null>；null 表示无数据（走 10.13 分支）。 */
export function loadStrokes(char) {
  return getStrokesLoader().load(char);
}

export function loadStrokesDetailed(char) {
  return getStrokesLoader().loadDetailed(char);
}

export function peekStrokes(char) {
  return getStrokesLoader().peek(char);
}

export function prefetchStrokes(chars) {
  getStrokesLoader().prefetch(chars);
}

/**
 * 盯住一个字的数据：先取一次；取不到时在 `online` 事件（联网恢复）时自动再取，直到拿到或 stop()（01 §8.5：
 * 「联网恢复后重试当前字并把按钮从『暂时没有提示』恢复」）。listener 收到：
 *   { status: 'loading' }                    同步窥视不到时先发一次
 *   { status: 'ready', data, source }
 *   { status: 'missing', reason }            进入 10.13 分支
 * 返回 { stop(), retry() }；retry() 手动再取一次（例如回到前台）。stop 之后不再回调。
 */
export function watchStrokes(char, listener, { win = typeof window !== 'undefined' ? window : null, loader = getStrokesLoader() } = {}) {
  let stopped = false;
  let status = null;
  let busy = false;
  const emit = event => {
    if (stopped) return;
    status = event.status;
    try {
      listener(event);
    } catch (error) {
      // 监听者自己的错误不影响加载器；抛到控制台由页面暴露。
      setTimeout(() => {
        throw error;
      }, 0);
    }
  };
  const onOnline = () => {
    if (status === 'missing') run();
  };
  const detach = () => {
    if (win && typeof win.removeEventListener === 'function') win.removeEventListener('online', onOnline);
  };
  function run() {
    if (stopped || busy) return;
    busy = true;
    loader.loadDetailed(char).then(detail => {
      busy = false;
      if (stopped) return;
      if (detail.data) {
        detach();
        emit({ status: 'ready', data: detail.data, source: detail.source });
      } else if (status !== 'missing') {
        emit({ status: 'missing', reason: detail.reason });
      }
    });
  }
  const cached = loader.peek(char);
  if (cached) {
    emit({ status: 'ready', data: cached, source: 'cache' });
    return { stop() { stopped = true; }, retry() {} };
  }
  if (win && typeof win.addEventListener === 'function') win.addEventListener('online', onOnline);
  emit({ status: 'loading' });
  run();
  return {
    stop() {
      stopped = true;
      detach();
    },
    retry() {
      if (status !== 'ready') run();
    },
  };
}
