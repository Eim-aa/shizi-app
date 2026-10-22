// 「空规则」域：协议本身（往返、通用 kv 状态、时钟、错误码）。B4.0 的验收「空规则下协议往返」就是这一域 + 坏请求。
export default {
  id: 'protocol',
  ops: {
    echo: { weight: 6, args: (g) => ({ value: g.value(3) }) },
    'kv.set': { weight: 6, args: (g) => ({ key: g.key(), value: g.value(2) }) },
    'kv.get': { weight: 2, args: (g) => ({ key: g.key() }) },
    'kv.delete': { weight: 2, args: (g) => ({ key: g.key() }) },
    'kv.keys': { weight: 1 },
    state: { weight: 1 },
    'clock.advance': {
      weight: 4,
      args: (g) => ({ ms: g.pick([1, -1, 60000, 3600000, -3600000, 86400000, -86400000, 7 * 86400000, g.int(-1e9, 1e9), 0.5, g.number()]) }),
    },
    reset: {
      weight: 0.5,
      args: (g) => (g.chance(0.5) ? {} : { state: { clock: g.time(), kv: g.chance(0.5) ? {} : { [g.key()]: g.value(1) } } }),
    },
    // 坏请求：参数缺 / 类型错、未知 op、请求不是对象、坏 JSON。两边错误码必须相同。
    'bad-args': {
      weight: 1,
      always: true,
      request: (g) => g.pick([
        { op: 'kv.set', args: { key: 1, value: 2 } },
        { op: 'kv.set', args: { key: 'a' } },
        { op: 'clock.set', args: { t: '1' } },
        { op: 'clock.advance', args: {} },
        { op: 'echo', args: {} },
        { op: 'reset', args: { state: [] } },
        { op: 'reset', args: { state: { kv: 3 } } },
        { op: 'dates.addDays', args: { day: '2026-01-01', n: '1' } },
        { op: 'dates.addDays', args: { day: '2026-01-01', n: 1e8 } },
        { op: 'dates.daysInMonth', args: { year: 2026.5, month: 2 } },
        { op: 'dates.periodOfHour', args: { hour: '5' } },
      ].filter((req) => g.available.has(req.op))),
    },
    'bad-request': {
      weight: 0.5,
      always: true,
      request: (g) => g.pick([
        { op: 'no.such.op', args: {} },
        { op: 'toString' },
        { op: '__proto__' },
        { op: 7 },
        { args: {} },
        { op: 'echo', args: [1] },
        { op: 'echo', args: null },
        { __raw: '[1,2]' },
        { __raw: '"x"' },
        { __raw: 'null' },
        { __raw: '{"op":' },
        { __raw: 'garbage' },
        { __raw: '{"op":"echo","args":{"value":01}}' },
        { id: g.int(0, 9), op: 'echo', args: { value: 1 } },
        { id: 'x', op: 'kv.keys', state: false },
      ]),
    },
  },
};
