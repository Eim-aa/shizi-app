// 卡片 / 题库域（src/core/cards.js、src/data/deck.js；B4.3）：真题库行 + 随机语境覆盖（含无效 w / ci、gloss / preserveCommon / py / promptHint 各分支）、
// 旧形态（无 ci）行、自定义卡，喂 applyContextOverride / buildCards / cardKey / 题面模型 / 题面 HTML / 可练谓词 / 换掉词语。
import { buildCards } from '../../../src/core/cards.js';
import { deckSources } from '../../build_core_config.mjs';

let deck = null;
const CHARS = ['人', '口', '静', '亦', '大', '一', '𠮷'];

export default {
  id: 'cards',
  prepare(g) {
    deck = deck || deckSources();
    const seed = deck.seed;
    const overrideKeys = Object.keys(deck.overrides);
    g.seedRow = () => seed[g.int(0, seed.length - 1)];
    g.craftedRow = () => {
      const ans = g.pick(['静静', '越来越', '人', '口口', '大人', '一', '𠮷口', '忠心耿耿']);
      const chars = Array.from(ans);
      const ci = g.int(0, chars.length - 1);
      const r = { py: g.pick(['jìng', 'yuè lái yuè', ' x  y ', 'rén', '', 'a b', 'dà rén']), hint: g.pick(['', '提示', undefined]), ans };
      if (g.chance(0.9)) { r.ci = ci; r.target = chars[ci]; }
      for (const [k, v] of Object.entries({ rank: g.pick([0, 1, 5, undefined]), strokes: g.pick([0, 8, undefined]), parts: g.pick([0, 2, undefined]), topic: g.pick(['', '语法', undefined]), d: g.pick([0, 34, undefined]), band: g.pick(['', '入门', undefined]), edu: g.pick([null, '表一', '', undefined]), common: g.pick([0, 2, 5, undefined]), norm: g.pick(['一级', '二级', '三级', '', undefined]), std: g.pick([0, 9, undefined]), ctx: g.pick(['dict', 'fallback', 'gloss', 'override', '', undefined]) })) if (v !== undefined) r[k] = v;
      if (g.chance(0.2)) r.promptHint = g.pick(['', '想想', ' x ']);
      return JSON.parse(JSON.stringify(r));
    };
    g.rowForCards = () => g.weighted([[() => g.seedRow(), 6], [() => g.craftedRow(), 3]])();
    g.targetOf = (row) => row.target || Array.from(row.ans)[Number(row.ci) || 0];
    /** 一张小的覆盖表（键 = 给定字时一定命中）。 */
    g.overrides = (targets) => {
      const o = {};
      for (const t of targets) {
        if (!g.chance(0.7)) continue;
        o[t] = g.weighted([
          [() => (deck.overrides[g.pick(overrideKeys)]), 4],
          [() => ({ boost: g.chance(0.5) }), 1],
          [() => ({ w: g.pick(['静静', '越来越', '大人', '人人', 'x']), ci: g.pick([0, 1, 2, '1', 1.5, -1, null, 99]), ...(g.chance(0.4) ? { py: g.pick([' jìng ', '', 5, 'x']) } : {}), ...(g.chance(0.3) ? { boost: true } : {}), ...(g.chance(0.3) ? { promptHint: g.pick([' 提示 ', '', 5]) } : {}) }), 3],
          [() => ({ gloss: g.pick(['释义', '', ' ']), ...(g.chance(0.5) ? { preserveCommon: g.pick([true, false, 1]) } : {}), ...(g.chance(0.4) ? { py: 'x ' } : {}), ...(g.chance(0.3) ? { boost: true } : {}) }), 3],
          [() => g.pick([null, 0, '', 5, 'x', [], {}, { py: 'only' }, { promptHint: ' only ' }]), 2],
        ])();
      }
      for (let i = 0; i < g.int(0, 2); i += 1) o[g.pick(overrideKeys)] = deck.overrides[g.pick(overrideKeys)];
      return o;
    };
    g.cardOf = () => g.weighted([
      [() => buildCards({ seed: [g.seedRow()], overrides: deck.overrides })[0], 6],
      [() => buildCards({ seed: [g.craftedRow()], overrides: {} })[0], 3],
      [() => ({ ...buildCards({ seed: [g.seedRow()], overrides: {} })[0], custom: true, hint: g.pick(['自定义提示', '', undefined]) }), 2],
    ])();
  },
  ops: {
    'cards.applyContextOverride': {
      weight: 4,
      args: (g) => {
        const source = g.rowForCards();
        const t = g.targetOf(source);
        return { source, overrides: g.chance(0.95) ? g.overrides([t, t, ...CHARS.slice(0, 2)]) : g.pick([null, [], 'x', 5]) };
      },
    },
    'cards.build': {
      weight: 3,
      args: (g) => {
        const rows = Array.from({ length: g.int(0, 3) }, () => g.rowForCards());
        return { rows, overrides: g.overrides(rows.map((r) => g.targetOf(r))) };
      },
    },
    'cards.cardKey': { weight: 1, args: (g) => ({ card: g.cardOf() }) },
    'cards.libraryIdsFor': { weight: 1.5, args: (g) => ({ card: g.cardOf() }) },
    'cards.libraries': { weight: 0.1, args: () => ({}) },
    'cards.promptModel': {
      weight: 3,
      args: (g) => ({ card: g.cardOf(), ...(g.chance(0.2) ? { copy: g.pick([{ repeatInstruction: 'R', fallbackHint: 'F', repeatBlankLabel: 'L', missingPinyin: 'M', repeatBlankGlyph: 'G' }, { fallbackHint: 'F' }, {}]) } : {}) }),
    },
    'cards.visibleHint': { weight: 2, args: (g) => ({ card: g.cardOf() }) },
    'cards.promptHTML': { weight: 2, args: (g) => ({ card: { ...g.cardOf(), ...(g.chance(0.2) ? { py: g.pick(['<b>&"\'', '', undefined]) } : {}) } }) },
    'deck.cardsOfRow': { weight: 3, args: (g) => ({ index: g.chance(0.95) ? g.int(0, deck.seed.length - 1) : g.pick([-1, 99999, 0]) }) },
    'deck.summary': { weight: 0.03, args: () => ({}) },
    'deck.cardForKey': { weight: 2, args: (g) => ({ key: g.weighted([[() => `base:${g.pick(deck.seed).target}`, 6], [() => g.pick(['custom:人', 'base:', 'x', '', 'base:𠮷', 'base:ab']), 2], [() => `base:${g.pick(CHARS)}`, 2]])() }) },
    'deck.isPracticable': { weight: 1.5, args: (g) => ({ key: g.weighted([[() => `base:${g.pick(deck.seed).target}`, 6], [() => g.pick(['custom:人', 'base:', 'x', '', 'base:𠮷']), 2]])() }) },
    'deck.hasContextWord': { weight: 1, args: (g) => ({ card: g.cardOf() }) },
    'deck.withWordOff': {
      weight: 2,
      args: (g) => {
        const card = g.cardOf();
        const wordOff = g.chance(0.6) ? { [`${card.custom ? 'custom' : 'base'}:${card.target}`]: 1 } : g.pick([{}, { 'base:x': 1 }, null, 5]);
        return { card, wordOff };
      },
    },
  },
};
