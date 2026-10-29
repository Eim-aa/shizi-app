// View arguments share the existing valid-state generator. Every seed covers every
// registered view op; the ordinary random table adds mixed protocol sequencing.
import { pageCases, pageNames } from './views-pages.mjs';
import { schedShapes } from '../lib/sched-shapes.mjs';

export function viewCases(g) {
  const S = schedShapes(g.r), state = S.state({ days: g.int(0, 8) }).state;
  const now = new Date(2026, 2, 2, 4).getTime() + g.int(0, 500) * S.DAY + g.pick([-1, 0, 1, 3599999, 3600000, 86400000]);
  const flag = () => g.chance(0.5);
  const policy = g.pick([{}, { features: { appearanceSwitch: false } }, { remindDefault: 'bad', groupSize: 20 }, { remindDefault: '7:03' }]);
  const settings = { ...(state.settings || {}), appearance: g.pick(['auto', 'dark', 'light', 'x']), remind: { enabled: flag(), permission: g.pick(['granted', 'denied', 'unknown', 'x']), hour: g.pick([0, 23, 7, 99, 1.5, null]), minute: g.pick([0, 59, 7, -1, null]) } };
  const credit = { id: g.string(), kind: g.pick(['font', 'code', 'data', 'x']), name: g.string(), version: g.pick(['1.2', '', null]), notice: g.string(), licenseFiles: ['a', 'b', 'a'], license: '', url: '' };
  const texts = { a: g.string() + '\n\uFEFF', b: ' \r\n' };
  const version = g.string(), build = g.pick(['20261001-abcdef123456', '20260101-', '', g.string()]);
  const day = g.pick(['2026-02-28', '2026-03-01', '2026-12-31', null, 'bad']);
  const month = g.pick(['2026-02', '2026-12']);
  const n = g.int(0, 9999);
  const rows = [
    ['view.about', { version, build }], ['view.about-privacy', { native: flag() }],
    ['view.about-credits', flag() ? { credits: [credit], texts } : {}], ['view.about-letter', {}],
    ['view.about.buildDay', { build }], ['view.about.stripArrow', { text: g.pick([g.string(), 'x \uFEFF› \n', 'x›y', null]) }],
    ['view.about.versionRefs', { version, build }], ['view.about.rows', {}],
    ['view.about.creditName', { credit }], ['view.about.creditFullText', { credit, texts }],
    ['view.about.creditGroups', { credits: [credit] }],
    ['view.settings', { settings, policy }], ['view.remind', { settings, policy }],
    ['view.settings.parseTime', { text: g.pick(['23:59', '0:00', '24:00', '20:0', ' 7:03\uFEFF', '', null, 123]) }],
    ['view.settings.timeText', { hour: g.pick([-2, 0, 7, 23, 99, 0.5]), minute: g.pick([0, 5, 59]) }],
    ['view.settings.defaultRemindTime', { policy }],
    ['view.library-switch', { state }], ['view.library-switch.name', { id: g.pick(['core3500', 'adv3000', 'x', null]) }],
    ['view.library-switch.desc', { id: g.pick(['core3500', 'adv3000', 'x']) }], ['view.library-switch.judgedChars', { state }],
    ['view.block', { kind: g.pick(['unavailable', 'blocked', 'migration']), canExport: flag(), still: flag(), exportFail: flag() }],
    ['view.block.reason', { status: g.pick([null, { available: false }, { available: true }, { available: true, blocked: { reason: 'write' } }]), migration: flag() ? { reason: 'v1' } : null }],
    ['view.block.hasJudged', { state }], ['view.block.backup', { state, now, serial: g.int(0, 10000) }],
    ['view.session-none', { exhausted: flag(), pick: flag(), wrongList: flag(), libSwitch: flag() }],
    ['view.kuan', { day, month: flag() ? month : null, n, part: g.int(0, 4), of: g.int(1, 4), brand: flag(), picked: flag(), now }],
    ['view.kuan.date', { day, now }], ['view.kuan.month', { month }], ['view.kuan.part', { i: n }],
    ['view.kuan.year', { year: g.int(0, 9999) }], ['view.kuan.cover', { n }],
    ['view.lines.measure', { spec: { text: g.string(), variant: 'empty-body' }, ...g.pick([{}, { result: [0, 3, 7] }, { result: false }, { throws: true }]) }],
  ];
  return rows.map(([op, args]) => ({ op, args, state: false })).concat(pageCases(g));
}
const names = [...pageNames,
  'view.about', 'view.about-privacy', 'view.about-credits', 'view.about-letter',
  'view.about.buildDay', 'view.about.stripArrow', 'view.about.versionRefs', 'view.about.rows', 'view.about.creditName', 'view.about.creditFullText', 'view.about.creditGroups',
  'view.settings', 'view.remind', 'view.settings.parseTime', 'view.settings.timeText', 'view.settings.defaultRemindTime',
  'view.library-switch', 'view.library-switch.name', 'view.library-switch.desc', 'view.library-switch.judgedChars',
  'view.block', 'view.block.reason', 'view.block.hasJudged', 'view.block.backup', 'view.session-none',
  'view.kuan', 'view.kuan.date', 'view.kuan.month', 'view.kuan.part', 'view.kuan.year', 'view.kuan.cover', 'view.lines.measure',
];
export default {
  id: 'views',
  sequence: viewCases,
  ops: Object.fromEntries(names.map(op => [op, { weight: 1, args: g => viewCases(g).find(r => r.op === op).args }])),
};
