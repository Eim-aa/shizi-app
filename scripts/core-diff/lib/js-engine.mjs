import { imagePlan } from '../../../src/core/images/pick.js';
import { buildWork } from '../../../src/core/images/work.js';
import * as imageLayout from '../../../src/core/images/layout.js';
import * as glyphLayout from '../../../src/core/images/glyph-layout.js';
import { paginate as imagePaginate } from '../../../src/core/images/paginate.js';
// ShiziCore 差分的 JS 参考引擎（B4.0；计划 §4.3 ④）。op 表与 ios/ShiziCore/Sources/ShiziCore/Engine/CoreEngine.swift 一一对应：
// 同一组 op 名、同一套参数校验（bad-args）、同一种错误码（JS RangeError → range、TypeError → type）。规则一律直接调 src/ 的无 DOM 集，
// 这里只有协议与参数适配，不写任何规则。协议全文见 ios/ShiziCore/README.md。
// 时区 = 进程时区（process.env.TZ）；Swift 命令行由驱动传同一个 TZ。
//
// fault（仅自检用，scripts/core-diff/run.mjs --self-test）：故意埋的错，证明差分能抓到、缩小能缩到最短。
//   'localDay-boundary'  不带 t 的 dates.localDay（取引擎时钟）把分界那一小时也算前一天（< 改成 ≤）——要先 clock.set 到 4 点那一小时才暴露，最短复现 2–3 步；
//   'number-format'      回包文字里 clock 写成「123.0」——值相等、字节不等，验证逐字节比对。
import * as dates from '../../../src/core/dates.js';
import { makeB41Ops } from './js-ops-b41.mjs';
import { makeB43Ops } from './js-ops-b43.mjs';
import { makeB42Ops } from './js-ops-b42.mjs';
import { makeB44Ops } from './js-ops-b44.mjs';
import { makeB45ViewOps } from './js-ops-b45v.mjs';
import { parseJson } from './json-parse.mjs';

export const PROTOCOL_VERSION = 1;

class CoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const badArgs = (m) => new CoreError('bad-args', m);
const has = (a, k) => Object.prototype.hasOwnProperty.call(a, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- 参数校验（与 CoreEngine.swift 同一规则）----
function required(a, k) {
  if (!has(a, k)) throw badArgs('missing ' + k);
  return a[k];
}
function str(a, k) {
  const v = required(a, k);
  if (typeof v !== 'string') throw badArgs(k + ' must be a string');
  return v;
}
function finite(v, k) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw badArgs(k + ' must be a finite number');
  return v;
}
function bounded(a, k) {
  const d = finite(required(a, k), k);
  if (Math.abs(d) > 1e7) throw badArgs(k + ' out of range');
  return d;
}
function int(a, k, limit) {
  const d = finite(required(a, k), k);
  if (Math.trunc(d) !== d || Math.abs(d) > limit) throw badArgs(k + ' must be an integer within range');
  return d;
}

function nullProto(obj) {
  const o = Object.create(null);
  for (const k of Object.keys(obj)) o[k] = obj[k];
  return o;
}

/** 新建一个参考引擎。 */
export function createJsEngine({ fault = null } = {}) {
  const st = { clock: 0, kv: Object.create(null) };
  const policyOf = (a) => (has(a, 'dayStartHour') ? { dayStartHour: a.dayStartHour } : undefined);
  // B4.4：store / storage / budget / backup / migrate（js-ops-b44.mjs）；store 会话进状态快照
  const b44 = makeB44Ops({ required, str, finite, int, badArgs, clock: () => st.clock, setClock: (t) => { st.clock = t; } });
  const tOf = (a) => (has(a, 't') ? a.t : st.clock);

  const OPS = {
    'images.plan': a => imagePlan(a.state,a.scope,{inkOf:r=>a.ink?.[r.id]??null,policy:{imageMaxChars:a.maxChars??80,monthSheetPick:a.monthPick??'first'}}),
    'images.work': a => buildWork({items:a.items,records:new Map(a.records.map(r=>[r.id,r])),hasInk:r=>a.inkIds.includes(r.id),added:a.added}),
    'images.layout': a => (a.sheet ? imageLayout.sheetPageLayout : imageLayout.layout)(int(a,'n',1_000_000),a.ratio ?? '3:4'),
    'images.sheetGrid': a => imageLayout.sheetGrid(int(a,'n',1_000_000),required(a,'width'),a),
    'images.glyphLayout': a => glyphLayout.glyphLayout(a.bounds ?? null,a.ratio ?? 'portrait'),
    'images.inkBounds': a => glyphLayout.inkBounds(a.points ?? []),
    'images.paginate': a => imagePaginate(a.cells,a.max),
    'images.withDayTags': a => imageLayout.withDayTags(a.cells),
    'images.sheetTags': a => imageLayout.sheetTags(a.cells),
    hello: () => ({ protocol: PROTOCOL_VERSION, engine: 'js', ops: Object.keys(OPS).sort() }),
    state: () => null,
    reset: (a) => {
      let clock = 0;
      let kv = Object.create(null);
      if (has(a, 'state')) {
        const s = a.state;
        if (!isObj(s)) throw badArgs('state must be an object');
        if (has(s, 'clock')) clock = finite(s.clock, 'state.clock');
        if (has(s, 'kv')) {
          if (!isObj(s.kv)) throw badArgs('state.kv must be an object');
          kv = nullProto(s.kv);
        }
      }
      st.clock = clock;
      st.kv = kv;
      b44.reset();
      return null;
    },
    echo: (a) => required(a, 'value'),
    'kv.set': (a) => {
      const key = str(a, 'key');
      const value = required(a, 'value');
      st.kv[key] = value;
      return null;
    },
    'kv.get': (a) => {
      const key = str(a, 'key');
      return has(st.kv, key) ? st.kv[key] : null;
    },
    'kv.delete': (a) => {
      const key = str(a, 'key');
      const had = has(st.kv, key);
      delete st.kv[key];
      return had;
    },
    'kv.keys': () => Object.keys(st.kv),
    'clock.set': (a) => {
      st.clock = finite(required(a, 't'), 't');
      return null;
    },
    'clock.advance': (a) => {
      st.clock += finite(required(a, 'ms'), 'ms');
      return st.clock;
    },

    'dates.calendarDay': (a) => dates.calendarDay(tOf(a)),
    'dates.localDay': (a) => {
      const policy = policyOf(a);
      if (fault === 'localDay-boundary' && !has(a, 't')) {
        const t = tOf(a);
        const day = dates.localDay(t, policy);
        const h = dates.dayStartHourOf(policy);
        return h && Number.isFinite(t) && new Date(t).getHours() === h ? dates.addDays(dates.calendarDay(t), -1) : day;
      }
      return dates.localDay(tOf(a), policy);
    },
    'dates.periodOf': (a) => dates.periodOf(tOf(a)),
    'dates.isValidDay': (a) => dates.isValidDay(required(a, 'value')),
    'dates.isValidMonth': (a) => dates.isValidMonth(required(a, 'value')),
    'dates.daysInMonth': (a) => dates.daysInMonth(int(a, 'year', 200000), int(a, 'month', 1000)),
    'dates.parseDay': (a) => dates.parseDay(required(a, 'day')),
    'dates.dayStartMs': (a) => dates.dayStartMs(required(a, 'day')),
    'dates.addDays': (a) => dates.addDays(required(a, 'day'), bounded(a, 'n')),
    'dates.diffDays': (a) => dates.diffDays(required(a, 'a'), required(a, 'b')),
    'dates.monthOf': (a) => dates.monthOf(required(a, 'dayOrMs')),
    'dates.addMonths': (a) => dates.addMonths(required(a, 'month'), bounded(a, 'n')),
    'dates.dayOfYear': (a) => dates.dayOfYear(required(a, 'day')),
    'dates.periodOfHour': (a) => {
      const h = required(a, 'hour');
      if (typeof h !== 'number') throw badArgs('hour must be a number');
      return dates.periodOfHour(h);
    },
    'dates.monthDayParts': (a) => dates.monthDayParts(required(a, 'day')),

    // B4.1：配置 / 题库 / 题记 / 文案 / 落款汉字数字 / 形状表 / 模型往返（js-ops-b41.mjs）
    ...makeB45ViewOps({ required, clock: () => st.clock }),
    ...makeB41Ops({ required, str, finite, int, badArgs }),

    // B4.3：记录 / 查字 / 卡片 / 结构 / 作品成员 / 取墨 / 首练结果页 / 提醒题目 / 墨编解码（js-ops-b43.mjs）
    ...makeB43Ops({ required, str, finite, int, badArgs }),
    // B4.2：FSRS 与出题调度（js-ops-b42.mjs）
    ...makeB42Ops({ required, str, finite, int, badArgs }),
    // B4.4：store / storage / budget / backup / migrate / 原生校验和（js-ops-b44.mjs）
    ...b44.ops,
  };

  const snapshot = () => {
    const store = b44.snapshot();
    return store ? { clock: st.clock, kv: st.kv, store } : { clock: st.clock, kv: st.kv };
  };

  function fail(out, code, message, withState) {
    out.ok = false;
    out.error = { code, message };
    if (withState) out.state = snapshot();
    return out;
  }

  /** 请求值 → 回包值。 */
  function handle(req) {
    const out = {};
    if (!isObj(req)) return fail(out, 'bad-request', 'request must be an object', true);
    if (has(req, 'id')) out.id = req.id;
    const withState = req.state !== false;
    if (typeof req.op !== 'string') return fail(out, 'bad-request', 'op must be a string', withState);
    let args = {};
    if (has(req, 'args')) {
      if (!isObj(req.args)) return fail(out, 'bad-request', 'args must be an object', withState);
      args = req.args;
    }
    if (!has(OPS, req.op)) return fail(out, 'unknown-op', 'unknown op: ' + req.op, withState);
    try {
      const reply = OPS[req.op](args);
      out.ok = true;
      out.reply = reply === undefined ? null : reply;
      if (withState) out.state = snapshot();
      return out;
    } catch (error) {
      const code = error instanceof CoreError ? error.code : error instanceof RangeError ? 'range' : error instanceof TypeError ? 'type' : 'error';
      return fail(out, code, String(error && error.message), withState);
    }
  }

  /** 一行请求 → 一行回包（线上的样子：JSON.stringify）。 */
  function handleLine(line) {
    let req;
    try {
      req = parseJson(line); // 不用 JSON.parse：V8 的一个快路径 bug，见 json-parse.mjs
    } catch (error) {
      return JSON.stringify(fail({}, 'bad-json', String(error.message), true));
    }
    const text = JSON.stringify(handle(req));
    return fault === 'number-format' ? text.replace(/"clock":(-?\d+)([,}])/, '"clock":$1.0$2') : text;
  }

  return { name: fault ? 'js~' + fault : 'js', handle, handleLine, ops: () => Object.keys(OPS).sort() };
}
